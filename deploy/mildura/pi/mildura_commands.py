#!/usr/bin/env python3
"""Mildura Phase 2: apply portal commands to the gate app's SQLite file.

Imported by mildura_mirror.py only when MIRROR_CONTROL=1. Standard library + the system
`openssl` binary only (no pip installs on the Pi).

Matched against the LIVE Mildura Pi ~/boomgate/app.py + database.py (pasted by Jarrod 4 Nov 2026;
"__mildura_fixpack_v2__"), which differs from the GitHub repo:
  * No user/schedule/lockdown cache: has_access(), is_auto_open() and is_lockdown() read SQLite on
    every call, so committed writes apply on the next PIN. Only manual-hold / rate limits are in memory.
  * WAL journal, busy_timeout 10 s, one short connection per call. BEGIN IMMEDIATE here is compatible.
  * users.schedule_type 'always' (data NULL) or 'time_range' json.dumps({"days","start","end"});
    start > end = overnight (tail belongs to the previous day); start == end never matches.
  * PIN: 4-8 digits, leading zero ALLOWED (issued PINs like 0xxx exist). has_access() also matches a
    PIN with its leading zeros stripped, so a new PIN must not collide with an existing one after
    ltrim('0'). The portal still limits to 4-6.
  * auto_schedules: days json.dumps([0-6]); validate_auto_window(): open != close, overnight <= 16 h.
    close_day (0=Mon..6=Sun, NULL = normal) is read by is_auto_open() but never written by the app;
    we never write it either. The ORO hold line is physically disconnected (hold_should_be_on()
    always False; a time clock holds the boom), so schedules drive no relay, BUT an active window
    makes POST /gate/open refuse remote opens (db.is_auto_open()).
  * changes_log(action, detail, changed_by[, synced on older DBs]); the app writes changed_by =
    session requester or "Admin"; we write "portal:<email>". Authorised persons: action AUTH_PERSON;
    a blank verification PIN is generated (4 digits, no leading zero, unique vs users and persons).

Safety contract (covered by tests/test_commands.py):
  * Only the kinds in KINDS are accepted. Gate actuation never touches GPIO: gate.open and
    gate.lockdown call the gate app's OWN admin routes on loopback (POST /gate/open, POST /lockdown
    state=on|off) after POST /login (form "pin") with the admin PIN held only in the Pi-local env
    file, and only when MIRROR_GATE_ACTIONS=1. Hold Open (/hold_open) only toggles GPIO23/ORO, which
    is disconnected on site, so gate.hold is always rejected.
  * gate.open is at-most-once: its changes_log tag is committed BEFORE the pulse is requested,
    and an open older than GATE_OPEN_MAX_AGE_S is refused rather than fired late.
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
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

KINDS = ("user.add", "user.update", "user.delete", "user.enable", "users.enable_all",
         "schedule.add", "schedule.enable", "schedule.delete", "person.add", "person.delete",
         "gate.open", "gate.lockdown")
GATE_KINDS = ("gate.open", "gate.lockdown")
RETIRED_KINDS = ("gate.hold",)
GATE_OPEN_MAX_AGE_S = 90
GATE_HTTP_TIMEOUT_S = 45     # /gate/open pulses synchronously and may wait ~25 s for a previous pulse
MAX_OVERNIGHT_MIN = 16 * 60  # database.validate_auto_window site limit
PIN_RE = re.compile(r"^\d{4,6}$")          # portal policy (the app accepts 4-8)
PERSON_PIN_RE = re.compile(r"^\d{4,8}$")
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


def _pin(v, admin_pin=None, rx=PIN_RE, what="PIN must be 4-6 digits"):
    if not isinstance(v, str) or not rx.match(v):
        raise Rejected(what)
    if admin_pin and v == admin_pin.strip():
        raise Rejected("that PIN is reserved")
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
    # users.pin is UNIQUE; has_access() also treats PINs equal after stripping leading zeros as the same.
    if con.execute("SELECT 1 FROM users WHERE (pin=? OR (ltrim(pin,'0')=ltrim(?,'0') AND pin GLOB '[0-9]*')) AND id IS NOT ?",
                   (pin, pin, except_user)).fetchone():
        raise Rejected("that PIN is already in use (or matches one with leading zeros)")


def _user_schedule(a):
    """Exactly the gate app's two formats (app.add_user / update_schedule, database.has_access)."""
    st = a.get("schedule_type", "always")
    if st in (None, "", "always"):
        return "always", None
    if st != "time_range":
        raise Rejected("schedule_type must be 'always' or 'time_range'")
    sd = a.get("schedule_data")
    try:
        d = json.loads(sd) if isinstance(sd, str) and len(sd) <= 500 else None
    except ValueError:
        d = None
    if not isinstance(d, dict) or set(d) != {"days", "start", "end"}:
        raise Rejected("time_range needs days, start and end")
    days, start, end = _days(d["days"]), _time(d["start"], "start"), _time(d["end"], "end")
    if start == end:
        raise Rejected("start and end cannot be the same")
    return "time_range", json.dumps({"days": days, "start": start, "end": end})


# ---------------------------------------------------------------- appliers (run inside the transaction)
def _user_add(con, a, s, cfg):
    name = _name(a.get("name"))
    pin = _pin(s.get("pin"), cfg.get("admin_pin"))
    _pin_free(con, pin)
    st, sd = _user_schedule(a)
    enabled = _bool(a.get("enabled", True))
    cur = con.execute("INSERT INTO users(name,pin,enabled,schedule_type,schedule_data) VALUES(?,?,?,?,?)", (name, pin, int(enabled), st, sd))
    return "ADD_USER", "Added user %s" % name, {"local_id": cur.lastrowid}


def _user_update(con, a, s, cfg):
    uid = _id(a.get("local_id")); _exists(con, "users", uid)
    sets, vals, what = [], [], []
    if "name" in a:
        sets.append("name=?"); vals.append(_name(a["name"])); what.append("name")
    if s.get("pin") is not None:
        pin = _pin(s["pin"], cfg.get("admin_pin")); _pin_free(con, pin, uid)
        sets.append("pin=?"); vals.append(pin); what.append("PIN")
    if "schedule_type" in a:
        st, sd = _user_schedule(a)
        sets += ["schedule_type=?", "schedule_data=?"]; vals += [st, sd]; what.append("schedule")
    if not sets:
        raise Rejected("nothing to change")
    con.execute("UPDATE users SET %s WHERE id=?" % ",".join(sets), vals + [uid])
    name = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()[0]
    return "EDIT_USER", "Edited user %s (%s)" % (name, ", ".join(what)), {"local_id": uid}


def _user_delete(con, a, s, cfg):
    uid = _id(a.get("local_id")); _exists(con, "users", uid)
    name = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()[0]
    con.execute("DELETE FROM users WHERE id=?", (uid,))
    return "DELETE_USER", "Deleted user %s" % name, {"local_id": uid}


def _user_enable(con, a, s, cfg):
    uid = _id(a.get("local_id")); _exists(con, "users", uid)
    en = _bool(a.get("enabled"))
    con.execute("UPDATE users SET enabled=? WHERE id=?", (int(en), uid))
    name = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()[0]
    return ("ENABLE_USER" if en else "DISABLE_USER"), "%s user %s" % ("Enabled" if en else "Disabled", name), {"local_id": uid}


def _users_enable_all(con, a, s, cfg):
    en = _bool(a.get("enabled"))
    n = con.execute("UPDATE users SET enabled = ?", (int(en),)).rowcount     # as database.enable/disable_all_users
    return ("ENABLE_ALL" if en else "DISABLE_ALL"), "%s all users (%d changed)" % ("Enabled" if en else "Disabled", n), {"changed": n}


def _schedule_add(con, a, s, cfg):
    name = _name(a.get("name"))
    days = _days(a.get("days"))
    o, c = _time(a.get("open_time"), "open_time"), _time(a.get("close_time"), "close_time")
    if o == c:
        raise Rejected("open and close time cannot be the same")
    om, cm = int(o[:2]) * 60 + int(o[3:]), int(c[:2]) * 60 + int(c[3:])
    if om > cm and (1440 - om + cm) > MAX_OVERNIGHT_MIN:
        raise Rejected("overnight window longer than 16 h (site limit); did you mean daytime hours?")
    # Same statement as database.add_auto_schedule(); close_day is never written by the app either.
    cur = con.execute("INSERT INTO auto_schedules (name, days, open_time, close_time) VALUES (?, ?, ?, ?)",
                      (name, json.dumps(days), o, c))
    return "ADD_SCHEDULE", "Added auto-open %s %s-%s" % (name, o, c), {"local_id": cur.lastrowid}


def _schedule_enable(con, a, s, cfg):
    sid = _id(a.get("local_id")); _exists(con, "auto_schedules", sid)
    en = _bool(a.get("enabled"))
    con.execute("UPDATE auto_schedules SET enabled=? WHERE id=?", (int(en), sid))
    name = con.execute("SELECT name FROM auto_schedules WHERE id=?", (sid,)).fetchone()[0]
    return ("ENABLE_SCHEDULE" if en else "DISABLE_SCHEDULE"), "%s auto-open %s" % ("Enabled" if en else "Disabled", name), {"local_id": sid}


def _schedule_delete(con, a, s, cfg):
    sid = _id(a.get("local_id")); _exists(con, "auto_schedules", sid)
    name = con.execute("SELECT name FROM auto_schedules WHERE id=?", (sid,)).fetchone()[0]
    con.execute("DELETE FROM auto_schedules WHERE id=?", (sid,))
    return "DELETE_SCHEDULE", "Deleted auto-open %s" % name, {"local_id": sid}


def _verification_pin(con):
    """As app._generate_verification_pin(): 4 digits, no leading zero, unused by any user or person."""
    import secrets as _s
    taken = {str(r[0]).strip() for r in con.execute("SELECT pin FROM users UNION SELECT pin FROM auth_persons") if r[0]}
    for _ in range(200):
        cand = str(1000 + _s.randbelow(9000))
        if cand not in taken:
            return cand
    raise Rejected("could not generate a free verification PIN; enter one")


def _person_add(con, a, s, cfg):
    name, role = _name(a.get("name")), _role(a.get("role"))
    phone, pin = s.get("phone") or "", s.get("pin") or ""
    if phone:
        if not isinstance(phone, str) or not PHONE_RE.match(phone):
            raise Rejected("phone is not valid")
        phone = phone.strip()
    if pin:
        pin = _pin(pin, cfg.get("admin_pin"), PERSON_PIN_RE, "verification PIN must be 4-8 digits")
        if con.execute("SELECT 1 FROM users WHERE pin=? UNION SELECT 1 FROM auth_persons WHERE pin=?", (pin, pin)).fetchone():
            raise Rejected("that verification PIN is already used by a user or another person")
    else:
        pin = _verification_pin(con)       # shown on the Pi dashboard only; never sent to the cloud
    cur = con.execute("INSERT INTO auth_persons (name, role, phone, pin) VALUES (?, ?, ?, ?)", (name, role, phone, pin))
    return "AUTH_PERSON", "Added authorised person %s (%s)" % (name, role or "no role"), {"local_id": cur.lastrowid}


def _person_delete(con, a, s, cfg):
    pid = _id(a.get("local_id")); _exists(con, "auth_persons", pid)
    name = con.execute("SELECT name FROM auth_persons WHERE id=?", (pid,)).fetchone()[0]
    con.execute("DELETE FROM auth_persons WHERE id=?", (pid,))
    return "AUTH_PERSON", "Removed authorised person %s" % name, {"local_id": pid}


APPLIERS = {"user.add": _user_add, "user.update": _user_update, "user.delete": _user_delete,
            "user.enable": _user_enable, "users.enable_all": _users_enable_all,
            "schedule.add": _schedule_add, "schedule.enable": _schedule_enable, "schedule.delete": _schedule_delete,
            "person.add": _person_add, "person.delete": _person_delete}
SECRET_KINDS = {"user.add": True, "user.update": False, "person.add": False}   # True = sealed value required


# ---------------------------------------------------------------- gate app's own admin routes (loopback)
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class LocalGate:
    """Talks to the gate app's admin routes exactly like its dashboard does: POST /login (form pin)
    for a Flask session, then POST /gate/open or POST /lockdown (state=on|off). Origin is set to
    the app's own host so the CSRF check on newer builds passes. Never touches GPIO."""

    def __init__(self, base_url, admin_pin, timeout=GATE_HTTP_TIMEOUT_S):
        if not base_url.startswith("http://127.0.0.1:") and not base_url.startswith("http://localhost:"):
            raise ValueError("gate URL must be loopback")
        self.base, self.pin, self.timeout = base_url.rstrip("/"), admin_pin, timeout
        self.jar = urllib.request.HTTPCookieProcessor()
        self.opener = urllib.request.build_opener(self.jar, _NoRedirect)

    def _post(self, path, form):
        req = urllib.request.Request(self.base + path, data=urllib.parse.urlencode(form).encode(), method="POST",
                                     headers={"Origin": self.base, "Content-Type": "application/x-www-form-urlencoded"})
        try:
            r = self.opener.open(req, timeout=self.timeout)
            return r.status, r.headers.get("Location", "")
        except urllib.error.HTTPError as e:          # 302 lands here because redirects are not followed
            return e.code, e.headers.get("Location", "") if e.headers else ""

    def status(self):
        with urllib.request.urlopen(self.base + "/api/status", timeout=5) as r:   # nosec B310 loopback
            return json.loads(r.read(65536))

    def login(self):
        code, loc = self._post("/login", {"pin": self.pin})
        if code != 302 or "/login" in loc:
            raise Rejected("gate app refused the local admin login (status %d)" % code)

    def action(self, path, form):
        self.login()
        code, loc = self._post(path, form)
        if code == 410:
            raise Rejected("not_supported: the gate app has retired this control")
        if code != 302 or "/login" in loc:
            raise Rejected("gate app did not accept %s (status %d)" % (path, code))


def _max_id(con, table):
    return con.execute('SELECT COALESCE(MAX(id), 0) FROM "%s"' % table).fetchone()[0]


def _gate_open_precheck(gate):
    st = gate.status()
    if st.get("lockdown"):
        raise Rejected("gate is in lockdown; no pulse sent")
    if st.get("auto_open"):
        # POST /gate/open refuses (and logs nothing) while an auto-open schedule window is active.
        raise Rejected("auto-open schedule '%s' is active; the gate app ignores remote opens" % str(st.get("auto_name") or "")[:60])


def _gate_open(con, cmd, cfg, gate):
    before = _max_id(con, "access_log")
    gate.action("/gate/open", {})
    # The route pulses synchronously, then logs REMOTE/dashboard (pulsed) or REMOTE/dashboard-no-pulse.
    for _ in range(int(cfg.get("verify_s", 5) * 10)):
        row = con.execute("SELECT method, success FROM access_log WHERE id > ? AND user_name = 'REMOTE' ORDER BY id LIMIT 1", (before,)).fetchone()
        if row:
            if row[0] == "dashboard" and row[1]:
                return {"pulse": "sent"}
            raise Rejected("gate app did not pulse (busy, boom still travelling, or lockdown); try again shortly")
        time.sleep(0.1)
    raise Rejected("gate app gave no confirmation; check the Pi dashboard")


def _gate_lockdown(con, cmd, cfg, gate):
    on = _bool(cmd["args"].get("on"), "on")
    gate.action("/lockdown", {"state": "on" if on else "off"})
    row = con.execute("SELECT value FROM settings WHERE key = 'lockdown'").fetchone()
    if (row[0] if row else "0") != ("1" if on else "0"):
        raise Rejected("lockdown state did not change on the Pi")
    return {"lockdown": on}


def _too_old(cmd, now=None):
    try:
        made = datetime.fromisoformat(str(cmd.get("created_at")).replace("Z", "+00:00"))
    except ValueError:
        return True
    if made.tzinfo is None:
        made = made.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - made).total_seconds() > GATE_OPEN_MAX_AGE_S


def open_rw(path):
    con = sqlite3.connect(path, timeout=10, isolation_level=None)   # explicit transactions only
    con.execute("PRAGMA busy_timeout=10000")
    return con


def tag(cmd_id):
    return "[portal %s]" % cmd_id


def _log_change(con, action, detail, actor, cid):
    cols, vals = ["action", "detail", "changed_by"], [action, "%s %s" % (detail, tag(cid)), "portal:" + actor]
    if "synced" in _cols(con, "changes_log"):
        cols.append("synced"); vals.append(0)
    con.execute("INSERT INTO changes_log (%s) VALUES (%s)" % (", ".join(cols), ", ".join("?" * len(cols))), vals)


def _already(con, cid):
    return con.execute("SELECT 1 FROM changes_log WHERE detail LIKE ?", ("%" + tag(cid) + "%",)).fetchone() is not None


def apply_one(con, cmd, key_path, decrypt=decrypt_sealed, cfg=None, gate=None):
    """Apply one command. Returns an ack dict {id, ok, error?, result?}. Never raises for bad input."""
    cfg = cfg or {}
    cid = cmd.get("id") if isinstance(cmd, dict) else None
    if not isinstance(cid, str) or not UUID_RE.match(cid):
        return {"id": cid if isinstance(cid, str) else "", "ok": False, "error": "bad command id"}
    try:
        kind = cmd.get("kind")
        if kind in RETIRED_KINDS:
            raise Rejected("not_supported: Hold Open drives GPIO23/ORO, which is disconnected on site; the time clock holds the boom")
        if kind not in KINDS:
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
        if kind in GATE_KINDS:
            return _apply_gate(con, cmd, kind, actor, cfg, gate)
        secrets = decrypt(key_path, sealed, cid) if sealed else {}
        con.execute("BEGIN IMMEDIATE")
        try:
            if _already(con, cid):
                con.execute("ROLLBACK")
                return {"id": cid, "ok": True, "result": {"already_applied": True}}
            action, detail, result = APPLIERS[kind](con, args, secrets, cfg)
            _log_change(con, action, detail, actor, cid)
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


def _apply_gate(con, cmd, kind, actor, cfg, gate):
    cid = cmd["id"]
    if kind == "gate.lockdown":
        _bool(cmd["args"].get("on"), "on")
    if gate is None:
        raise Rejected("not_supported: gate actions are not enabled on this Pi (MIRROR_GATE_ACTIONS)")
    if kind == "gate.open" and _too_old(cmd):
        raise Rejected("open request too old; not sent late")
    if kind == "gate.open":
        try:
            _gate_open_precheck(gate)       # read-only; refuse before marking so nothing is logged
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise Rejected("gate app not reachable on loopback (%s)" % type(e).__name__)
    # Mark first (at-most-once): a re-delivered open after a crash must never pulse twice.
    con.execute("BEGIN IMMEDIATE")
    try:
        if _already(con, cid):
            con.execute("ROLLBACK")
            return {"id": cid, "ok": True, "result": {"already_applied": True}}
        if kind == "gate.open":
            _log_change(con, "REMOTE_OPEN", "Portal requested an opening pulse", actor, cid)
        else:
            on = _bool(cmd["args"].get("on"), "on")
            _log_change(con, "LOCKDOWN", "Portal %s software access" % ("paused" if on else "resumed"), actor, cid)
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    try:
        result = (_gate_open if kind == "gate.open" else _gate_lockdown)(con, cmd, cfg, gate)
    except (urllib.error.URLError, OSError) as e:
        raise Rejected("gate app not reachable on loopback (%s)" % type(e).__name__)
    return {"id": cid, "ok": True, "result": result}


def apply_all(db_path, commands, key_path, decrypt=decrypt_sealed, cfg=None, gate=None):
    """Apply in queue order. Transient DB errors are not acked, so the cloud re-delivers them."""
    acks = []
    con = open_rw(db_path)
    try:
        for c in sorted(commands, key=lambda c: c.get("seq", 0) if isinstance(c, dict) else 0):
            ack = apply_one(con, c, key_path, decrypt, cfg, gate)
            if ack.pop("retry", False):
                break                      # keep order: stop and retry this one next poll
            acks.append(ack)
    finally:
        con.close()
    return acks
