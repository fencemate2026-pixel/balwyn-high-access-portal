#!/usr/bin/env python3
"""Mildura Phase 2: apply portal commands to the gate app's SQLite file.

Imported by mildura_mirror.py only when MIRROR_CONTROL=1. Standard library + the system
`openssl` binary only (no pip installs on the Pi).

Safety contract (covered by tests/test_commands.py):
  * Only the kinds in KINDS are accepted. Gate actuation (open / hold / lockdown) is NOT
    implemented: the gate app's source and local control API are unknown, and this service
    must never drive GPIO. Those kinds are rejected with "not_supported".
  * Every write is one short BEGIN IMMEDIATE transaction that also inserts a changes_log row
    (changed_by "portal:<owner email>") tagged with the command id. The tag makes a command
    idempotent inside the database itself: a re-delivered command is detected and not re-applied.
  * Everything is validated here, on the Pi, even though the portal validated it too:
    names, PIN 4-6 digits and unique across users + authorised persons, ids exist, times, days.
  * PINs arrive only as RSA-OAEP ciphertext bound to the command id; they are decrypted in memory,
    written to the gate database (where the gate app already keeps them) and never logged,
    echoed in results, or written to changes_log.
"""
import base64
import json
import re
import sqlite3
import subprocess

KINDS = ("user.add", "user.update", "user.delete", "user.enable", "users.enable_all",
         "schedule.add", "schedule.enable", "schedule.delete", "person.add", "person.delete")
GATE_KINDS = ("gate.open", "gate.hold", "gate.lockdown")
PIN_RE = re.compile(r"^\d{4,6}$")
PHONE_RE = re.compile(r"^\+?[0-9 ]{8,16}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
NAME_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,60}$")
EMAIL_RE = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,190}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class Rejected(Exception):
    """A command that must not be applied. The message goes back to the portal (never contains a PIN)."""


# ---------------------------------------------------------------- decryption (openssl CLI)
def decrypt_sealed(key_path, sealed_b64, cmd_id, run=subprocess.run):
    """RSA-OAEP(SHA-256) decrypt with the Pi's private key. The plaintext must name this command id,
    so ciphertext cannot be replayed onto (or swapped into) a different command."""
    try:
        blob = base64.b64decode(sealed_b64, validate=True)
    except (ValueError, TypeError):
        raise Rejected("sealed value is not valid base64")
    p = run(["openssl", "pkeyutl", "-decrypt", "-inkey", key_path,
             "-pkeyopt", "rsa_padding_mode:oaep", "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256"],
            input=blob, capture_output=True, timeout=10)
    if p.returncode != 0:
        raise Rejected("sealed value could not be decrypted with this Pi's key")
    try:
        secrets = json.loads(p.stdout.decode())
    except ValueError:
        raise Rejected("sealed value is not valid JSON")
    if not isinstance(secrets, dict) or secrets.get("cmd") != cmd_id:
        raise Rejected("sealed value belongs to a different command")
    return secrets


def public_key_pem(key_path, run=subprocess.run):
    p = run(["openssl", "pkey", "-in", key_path, "-pubout"], capture_output=True, timeout=10)
    if p.returncode != 0:
        raise RuntimeError("cannot derive public key")
    return p.stdout.decode()


# ---------------------------------------------------------------- validation helpers
def _name(v, field="name"):
    if not isinstance(v, str) or not NAME_RE.match(v.strip()) or re.search(r"\d{4,}", v):
        raise Rejected("%s must be 1-60 characters with no control characters or long digit runs" % field)
    return v.strip()


def _role(v):
    if v in (None, ""):
        return ""
    return _name(v, "role")


def _id(v):
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise Rejected("local_id must be a positive integer")
    return v


def _bool(v, field="enabled"):
    if not isinstance(v, bool):
        raise Rejected("%s must be true or false" % field)
    return v


def _pin(v):
    if not isinstance(v, str) or not PIN_RE.match(v):
        raise Rejected("PIN must be 4-6 digits")
    return v


def _days(v):
    if not isinstance(v, list) or not v or len(v) > 7 or any(isinstance(d, bool) or not isinstance(d, int) or d < 0 or d > 6 for d in v) or len(set(v)) != len(v):
        raise Rejected("days must be a non-empty list of distinct day numbers 0-6 (Mon=0)")
    return sorted(v)


def _time(v, field):
    if not isinstance(v, str) or not TIME_RE.match(v):
        raise Rejected("%s must be HH:MM (24 h)" % field)
    return v


def _cols(con, table):
    return {r[1] for r in con.execute('PRAGMA table_info("%s")' % table)}


def _exists(con, table, local_id):
    if not con.execute('SELECT 1 FROM "%s" WHERE id=?' % table, (local_id,)).fetchone():
        raise Rejected("%s %d no longer exists on the Pi" % (table, local_id))


def _pin_free(con, pin, except_user=None):
    if con.execute("SELECT 1 FROM users WHERE pin=? AND id IS NOT ?", (pin, except_user)).fetchone():
        raise Rejected("that PIN is already in use")
    if "pin" in _cols(con, "auth_persons") and con.execute("SELECT 1 FROM auth_persons WHERE pin=?", (pin,)).fetchone():
        raise Rejected("that PIN is already in use")


def _user_schedule(con, args):
    """'always' is always allowed. Any other schedule_type is accepted only if the gate app already uses
    it on this Pi AND the new schedule_data has the same JSON shape as an existing row, so we never
    invent a format the (unseen) gate app might read differently."""
    st = args.get("schedule_type", "always")
    if st in (None, "", "always"):
        return "always", None
    if not isinstance(st, str) or not re.match(r"^[a-z_]{1,40}$", st):
        raise Rejected("schedule_type is not valid")
    sd = args.get("schedule_data")
    if not isinstance(sd, str) or len(sd) > 2000:
        raise Rejected("schedule_data must be a JSON string")
    try:
        new = json.loads(sd)
    except ValueError:
        raise Rejected("schedule_data must be valid JSON")
    shapes = []
    for (old,) in con.execute("SELECT schedule_data FROM users WHERE schedule_type=? AND schedule_data IS NOT NULL", (st,)):
        try:
            o = json.loads(old)
        except (ValueError, TypeError):
            continue
        shapes.append(sorted(o.keys()) if isinstance(o, dict) else type(o).__name__)
    if not shapes:
        raise Rejected("schedule type '%s' is not used on this Pi yet; set it once on the Pi dashboard first" % st)
    shape = sorted(new.keys()) if isinstance(new, dict) else type(new).__name__
    if shape not in shapes:
        raise Rejected("schedule_data does not match the format the gate app uses for '%s'" % st)
    return st, sd


def _days_repr(con, days):
    """Store auto_schedule days in the representation existing rows already use (JSON list or CSV)."""
    row = con.execute("SELECT days FROM auto_schedules WHERE days IS NOT NULL ORDER BY id LIMIT 1").fetchone()
    if row and isinstance(row[0], str) and not row[0].lstrip().startswith("["):
        return ",".join(str(d) for d in days)
    return json.dumps(days)


# ---------------------------------------------------------------- appliers (run inside the transaction)
def _user_add(con, a, s):
    name = _name(a.get("name"))
    pin = _pin(s.get("pin"))
    _pin_free(con, pin)
    st, sd = _user_schedule(con, a)
    enabled = _bool(a.get("enabled", True))
    cur = con.execute("INSERT INTO users(name,pin,enabled,schedule_type,schedule_data) VALUES(?,?,?,?,?)", (name, pin, int(enabled), st, sd))
    return "ADD_USER", "Added user %s" % name, {"local_id": cur.lastrowid}


def _user_update(con, a, s):
    uid = _id(a.get("local_id")); _exists(con, "users", uid)
    sets, vals, what = [], [], []
    if "name" in a:
        sets.append("name=?"); vals.append(_name(a["name"])); what.append("name")
    if s.get("pin") is not None:
        pin = _pin(s["pin"]); _pin_free(con, pin, uid)
        sets.append("pin=?"); vals.append(pin); what.append("PIN")
    if "schedule_type" in a:
        st, sd = _user_schedule(con, a)
        sets += ["schedule_type=?", "schedule_data=?"]; vals += [st, sd]; what.append("schedule")
    if not sets:
        raise Rejected("nothing to change")
    con.execute("UPDATE users SET %s WHERE id=?" % ",".join(sets), vals + [uid])
    name = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()[0]
    return "EDIT_USER", "Edited user %s (%s)" % (name, ", ".join(what)), {"local_id": uid}


def _user_delete(con, a, s):
    uid = _id(a.get("local_id")); _exists(con, "users", uid)
    name = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()[0]
    con.execute("DELETE FROM users WHERE id=?", (uid,))
    return "DELETE_USER", "Deleted user %s" % name, {"local_id": uid}


def _user_enable(con, a, s):
    uid = _id(a.get("local_id")); _exists(con, "users", uid)
    en = _bool(a.get("enabled"))
    con.execute("UPDATE users SET enabled=? WHERE id=?", (int(en), uid))
    name = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()[0]
    return ("ENABLE_USER" if en else "DISABLE_USER"), "%s user %s" % ("Enabled" if en else "Disabled", name), {"local_id": uid}


def _users_enable_all(con, a, s):
    en = _bool(a.get("enabled"))
    n = con.execute("UPDATE users SET enabled=? WHERE enabled IS NOT ?", (int(en), int(en))).rowcount
    return ("ENABLE_ALL" if en else "DISABLE_ALL"), "%s all users (%d changed)" % ("Enabled" if en else "Disabled", n), {"changed": n}


def _schedule_add(con, a, s):
    name = _name(a.get("name"))
    days = _days(a.get("days"))
    o, c = _time(a.get("open_time"), "open_time"), _time(a.get("close_time"), "close_time")
    if o == c:
        raise Rejected("open and close time cannot be the same")
    cols = ["name", "days", "open_time", "close_time", "enabled"]
    vals = [name, _days_repr(con, days), o, c, 1]
    if "close_day" in _cols(con, "auto_schedules") and a.get("close_day") is not None:
        cd = a["close_day"]
        if isinstance(cd, bool) or not isinstance(cd, int) or not 0 <= cd <= 6:
            raise Rejected("close_day must be 0-6")
        cols.append("close_day"); vals.append(cd)
    cur = con.execute("INSERT INTO auto_schedules(%s) VALUES(%s)" % (",".join(cols), ",".join("?" * len(cols))), vals)
    return "ADD_SCHEDULE", "Added auto-open %s %s-%s" % (name, o, c), {"local_id": cur.lastrowid}


def _schedule_enable(con, a, s):
    sid = _id(a.get("local_id")); _exists(con, "auto_schedules", sid)
    en = _bool(a.get("enabled"))
    con.execute("UPDATE auto_schedules SET enabled=? WHERE id=?", (int(en), sid))
    name = con.execute("SELECT name FROM auto_schedules WHERE id=?", (sid,)).fetchone()[0]
    return ("ENABLE_SCHEDULE" if en else "DISABLE_SCHEDULE"), "%s auto-open %s" % ("Enabled" if en else "Disabled", name), {"local_id": sid}


def _schedule_delete(con, a, s):
    sid = _id(a.get("local_id")); _exists(con, "auto_schedules", sid)
    name = con.execute("SELECT name FROM auto_schedules WHERE id=?", (sid,)).fetchone()[0]
    con.execute("DELETE FROM auto_schedules WHERE id=?", (sid,))
    return "DELETE_SCHEDULE", "Deleted auto-open %s" % name, {"local_id": sid}


def _person_add(con, a, s):
    name, role = _name(a.get("name")), _role(a.get("role"))
    have = _cols(con, "auth_persons")
    cols, vals = ["name", "role"], [name, role]
    phone, pin = s.get("phone"), s.get("pin")
    if phone not in (None, ""):
        if not isinstance(phone, str) or not PHONE_RE.match(phone):
            raise Rejected("phone is not valid")
        if "phone" in have:
            cols.append("phone"); vals.append(phone.replace(" ", ""))
    if pin not in (None, ""):
        pin = _pin(pin); _pin_free(con, pin)
        if "pin" not in have:
            raise Rejected("this Pi's authorised persons have no PIN column")
        cols.append("pin"); vals.append(pin)
    cur = con.execute("INSERT INTO auth_persons(%s) VALUES(%s)" % (",".join(cols), ",".join("?" * len(cols))), vals)
    return "ADD_PERSON", "Added authorised person %s" % name, {"local_id": cur.lastrowid}


def _person_delete(con, a, s):
    pid = _id(a.get("local_id")); _exists(con, "auth_persons", pid)
    name = con.execute("SELECT name FROM auth_persons WHERE id=?", (pid,)).fetchone()[0]
    con.execute("DELETE FROM auth_persons WHERE id=?", (pid,))
    return "DELETE_PERSON", "Deleted authorised person %s" % name, {"local_id": pid}


APPLIERS = {"user.add": _user_add, "user.update": _user_update, "user.delete": _user_delete,
            "user.enable": _user_enable, "users.enable_all": _users_enable_all,
            "schedule.add": _schedule_add, "schedule.enable": _schedule_enable, "schedule.delete": _schedule_delete,
            "person.add": _person_add, "person.delete": _person_delete}
SECRET_KINDS = {"user.add": True, "user.update": False, "person.add": False}   # True = sealed value required


def open_rw(path):
    con = sqlite3.connect(path, timeout=10, isolation_level=None)   # explicit transactions only
    con.execute("PRAGMA busy_timeout=10000")
    return con


def tag(cmd_id):
    return "[portal %s]" % cmd_id


def apply_one(con, cmd, key_path, decrypt=decrypt_sealed):
    """Apply one command. Returns an ack dict {id, ok, error?, result?}. Never raises for bad input."""
    cid = cmd.get("id") if isinstance(cmd, dict) else None
    if not isinstance(cid, str) or not UUID_RE.match(cid):
        return {"id": cid if isinstance(cid, str) else "", "ok": False, "error": "bad command id"}
    try:
        kind = cmd.get("kind")
        if kind in GATE_KINDS:
            raise Rejected("not_supported: gate actuation is not wired on this Pi")
        if kind not in APPLIERS:
            raise Rejected("unknown command kind")
        args = cmd.get("args")
        if not isinstance(args, dict) or any(k.lower() in ("pin", "phone") for k in args):
            raise Rejected("args must be an object without plaintext secrets")
        actor = cmd.get("actor_email")
        if not isinstance(actor, str) or not EMAIL_RE.match(actor):
            raise Rejected("actor_email missing")
        sealed = cmd.get("sealed")
        if SECRET_KINDS.get(kind) and not sealed:
            raise Rejected("this command needs a sealed PIN")
        if sealed and kind not in SECRET_KINDS:
            raise Rejected("unexpected sealed value")
        secrets = decrypt(key_path, sealed, cid) if sealed else {}
        con.execute("BEGIN IMMEDIATE")
        try:
            have = _cols(con, "changes_log")
            if con.execute("SELECT 1 FROM changes_log WHERE detail LIKE ?", ("%" + tag(cid) + "%",)).fetchone():
                con.execute("ROLLBACK")
                return {"id": cid, "ok": True, "result": {"already_applied": True}}
            action, detail, result = APPLIERS[kind](con, args, secrets)
            cols, vals = ["action", "detail", "changed_by"], [action, "%s %s" % (detail, tag(cid)), "portal:" + actor]
            if "synced" in have:
                cols.append("synced"); vals.append(0)
            con.execute("INSERT INTO changes_log(%s) VALUES(%s)" % (",".join(cols), ",".join("?" * len(cols))), vals)
            con.execute("COMMIT")
        except BaseException:
            con.execute("ROLLBACK")
            raise
        return {"id": cid, "ok": True, "result": result}
    except Rejected as e:
        return {"id": cid, "ok": False, "error": str(e)[:300]}
    except sqlite3.IntegrityError:
        return {"id": cid, "ok": False, "error": "the gate database refused the change (constraint)"}
    except sqlite3.Error as e:
        return {"id": cid, "ok": False, "error": "database busy or unavailable (%s)" % type(e).__name__, "retry": True}


def apply_all(db_path, commands, key_path, decrypt=decrypt_sealed):
    """Apply in queue order. Transient DB errors are not acked, so the cloud re-delivers them."""
    acks = []
    con = open_rw(db_path)
    try:
        for c in sorted(commands, key=lambda c: c.get("seq", 0) if isinstance(c, dict) else 0):
            ack = apply_one(con, c, key_path, decrypt)
            if ack.pop("retry", False):
                break                      # keep order: stop and retry this one next poll
            acks.append(ack)
    finally:
        con.close()
    return acks
