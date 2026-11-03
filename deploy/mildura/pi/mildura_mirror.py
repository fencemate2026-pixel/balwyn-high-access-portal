#!/usr/bin/env python3
"""Mildura gate mirror: outbound-only sync from the gate app's SQLite file to the
Magic Keys cloud (edge function `gd-mirror`).

Phase 2 (MIRROR_CONTROL=1, off by default): the same service also polls gd-mirror for portal
commands over outbound HTTPS and applies them through mildura_commands.py, the ONLY code that
writes to the gate database. The mirror read path below stays read-only. Phase 1 behaviour is
unchanged when MIRROR_CONTROL is unset.

Safety contract (every point is enforced in code and covered by tests/test_mirror.py):
  * The gate database is opened read-only (SQLite URI mode=ro + PRAGMA query_only). This
    process never writes to it, never touches GPIO, and never imports the gate app.
  * PINs never leave the Pi. Columns are allowlisted per table; `pin`, `attempted_pin`
    and every other column not on the list are never selected. Free text is scrubbed of
    4-8 digit runs before upload.
  * Outbound HTTPS only. No listening socket. No network, Tailscale, sshd or WiFi changes.
  * Any failure is logged and retried with back-off. Nothing here can raise into, block or
    slow the gate: this is a separate systemd unit with low priority.
  * Progress marks live in this service's own state file, not in the gate database.
Standard library only (no pip installs on the Pi).
"""
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request

VERSION = "2.2.0"
COMMAND_INTERVAL_S = 10       # Phase 2 command poll (tiny request)
INTERVAL_S = 60                # normal cycle
BACKOFF_MAX_S = 900            # cap when the cloud is unreachable
HTTP_TIMEOUT_S = 20
BATCH_ROWS = 200
STATUS_URL_DEFAULT = "http://127.0.0.1:5000/api/status"
STATUS_TIMEOUT_S = 3
DIGIT_RUN = re.compile(r"\d{4,8}")

# Allowlists. Anything not listed here is never read. `pin` / `attempted_pin` are absent on purpose.
TABLE_COLUMNS = {
    "users": ("id", "name", "enabled", "schedule_type", "schedule_data", "created_at"),
    "auto_schedules": ("id", "name", "days", "open_time", "close_time", "enabled", "created_at"),
    "auth_persons": ("id", "name", "role"),
    "access_log": ("id", "user_name", "method", "success", "timestamp"),
    "changes_log": ("id", "action", "detail", "changed_by", "timestamp"),
}
SNAPSHOT_TABLES = ("users", "auto_schedules", "auth_persons")   # small; sent whole when changed
STREAM_TABLES = ("access_log", "changes_log")                    # append-only; sent by id watermark
FREE_TEXT = {"detail", "user_name", "name", "schedule_data"}


def log(msg):
    print("[mildura-mirror] " + msg, flush=True)


def scrub(value):
    """Remove anything shaped like a PIN from free text."""
    if isinstance(value, str):
        return DIGIT_RUN.sub("####", value)
    return value


def open_ro(path):
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=5)
    con.execute("PRAGMA query_only=ON")
    con.row_factory = sqlite3.Row
    return con


def existing_columns(con, table):
    return [r[1] for r in con.execute('PRAGMA table_info("%s")' % table)]


def safe_columns(con, table):
    """Allowlisted columns that actually exist in this Pi's version of the schema."""
    have = set(existing_columns(con, table))
    return [c for c in TABLE_COLUMNS[table] if c in have]


def clean_row(table, row):
    out = {}
    for k in row.keys():
        v = row[k]
        out[k] = scrub(v) if k in FREE_TEXT else v
    return out


def read_snapshot(con, table):
    cols = safe_columns(con, table)
    if not cols or "id" not in cols:
        return []
    sql = 'SELECT %s FROM "%s" ORDER BY id' % (", ".join('"%s"' % c for c in cols), table)
    return [clean_row(table, r) for r in con.execute(sql)]


def read_stream(con, table, after_id, limit=BATCH_ROWS):
    cols = safe_columns(con, table)
    if not cols or "id" not in cols:
        return []
    sql = 'SELECT %s FROM "%s" WHERE id > ? ORDER BY id LIMIT ?' % (", ".join('"%s"' % c for c in cols), table)
    return [clean_row(table, r) for r in con.execute(sql, (after_id, limit))]


def digest(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def load_state(path):
    try:
        with open(path) as fh:
            s = json.load(fh)
        if isinstance(s, dict):
            return s
    except (OSError, ValueError):
        pass
    return {}


def save_state(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(state, fh)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def local_status(url):
    """Best-effort read of the gate app's own /api/status on loopback. Never fatal."""
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=STATUS_TIMEOUT_S) as r:   # nosec B310 loopback
            data = json.loads(r.read(65536))
        # Live Pi app: auto_open/auto_name/hold/signal_on/manual_hold/lockdown/gpio; older builds also
        # control_mode/software_access_paused/gate_position. Booleans and short labels only.
        keep = ("lockdown", "software_access_paused", "control_mode", "gpio", "gate_position",
                "auto_open", "auto_name", "hold", "signal_on", "manual_hold")
        return {k: data.get(k) for k in keep if k in data}
    except Exception:
        return None


def post(url, body):
    req = urllib.request.Request(
        url, data=json.dumps(body, default=str).encode(),
        headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:        # nosec B310 https only (checked in main)
        return json.loads(r.read(1 << 20))


def build_payload(con, state, creds, status_url, caps=()):
    """Return (payload, commit) where commit(state) advances the marks after the cloud acks."""
    status = local_status(status_url)
    if caps:                            # what this Pi will accept from the portal (Phase 2)
        status = dict(status or {}, mirror_caps=sorted(caps))
    payload = {"device_id": creds["device_id"], "secret": creds["secret"], "action": "push",
               "fw_version": "mirror-" + VERSION, "status": status, "snapshots": {}, "streams": {}}
    snap_marks, stream_marks = {}, {}
    for t in SNAPSHOT_TABLES:
        rows = read_snapshot(con, t)
        d = digest(rows)
        if state.get("snap", {}).get(t) != d:
            payload["snapshots"][t] = rows
            snap_marks[t] = d
    for t in STREAM_TABLES:
        after = int(state.get("stream", {}).get(t, 0))
        rows = read_stream(con, t, after)
        if rows:
            payload["streams"][t] = rows
            stream_marks[t] = rows[-1]["id"]

    def commit(st):
        st.setdefault("snap", {}).update(snap_marks)
        st.setdefault("stream", {}).update(stream_marks)
    return payload, commit, bool(stream_marks) and any(len(payload["streams"][t]) >= BATCH_ROWS for t in payload["streams"])


def cycle(db_path, url, creds, state, state_path, status_url, caps=()):
    """One sync pass. Returns True if more backlog remains (caller loops immediately)."""
    con = open_ro(db_path)
    try:
        payload, commit, more = build_payload(con, state, creds, status_url, caps)
    finally:
        con.close()
    resp = post(url, payload)
    if not resp.get("ok"):
        raise RuntimeError("cloud refused: %s" % resp.get("error", "unknown"))
    commit(state)                       # advance only after the cloud acked
    state["last_ok"] = int(time.time())
    save_state(state_path, state)
    return more


def read_creds(path):
    with open(path) as fh:
        cfg = dict(l.strip().split("=", 1) for l in fh if "=" in l and not l.lstrip().startswith("#"))
    return cfg


def command_cycle(db_path, url, creds, key_path, state, state_path, cfg=None, gate=None):
    """Phase 2: register the public key once, fetch queued commands, apply, ack. Returns #acked."""
    import mildura_commands as mc
    base = {"device_id": creds["device_id"], "secret": creds["secret"]}
    if not state.get("key_registered"):
        resp = post(url, dict(base, action="key", pubkey=mc.public_key_pem(key_path)))
        if not resp.get("ok") or not resp.get("registered"):
            raise RuntimeError("cloud holds a different command key for this unit; refusing to apply commands")
        state["key_registered"] = True
        save_state(state_path, state)
    resp = post(url, dict(base, action="commands"))
    if not resp.get("ok"):
        raise RuntimeError("cloud refused: %s" % resp.get("error", "unknown"))
    cmds = resp.get("commands") or []
    if not isinstance(cmds, list) or not cmds:
        return 0
    acks = mc.apply_all(db_path, cmds[:20], key_path, cfg=cfg, gate=gate)
    for a in acks:
        log("command %s %s%s" % (a["id"][:8], "applied" if a["ok"] else "rejected", "" if a["ok"] else ": " + a.get("error", "")))
    if acks:
        r = post(url, dict(base, action="ack", results=acks))
        if not r.get("ok"):
            raise RuntimeError("ack refused")
    return len(acks)


def main():
    env_file = os.environ.get("MIRROR_ENV", "/etc/mildura-mirror.env")
    cfg = read_creds(env_file)
    url = cfg.get("MIRROR_URL", "")
    if not url.startswith("https://"):
        log("MIRROR_URL must be https://; refusing to start")
        return 2
    creds = {"device_id": cfg.get("MIRROR_DEVICE_ID", ""), "secret": cfg.get("MIRROR_SECRET", "")}
    if not creds["device_id"] or len(creds["secret"]) < 32:
        log("device id / secret missing or too short; refusing to start")
        return 2
    db_path = cfg.get("MIRROR_DB", "")
    state_path = cfg.get("MIRROR_STATE", "/var/lib/mildura-mirror/state.json")
    status_url = cfg.get("MIRROR_STATUS_URL", STATUS_URL_DEFAULT)
    if not os.path.exists(db_path):
        log("gate database not found at configured path; refusing to start")
        return 2
    control = cfg.get("MIRROR_CONTROL", "0") == "1"
    key_path = cfg.get("MIRROR_COMMAND_KEY", "/var/lib/mildura-mirror/command_key.pem")
    if control and not os.path.exists(key_path):
        log("MIRROR_CONTROL=1 but no command key at %s; commands disabled" % key_path)
        control = False
    ccfg = {"admin_pin": cfg.get("GATE_ADMIN_PIN", "") or None}
    gate, caps = None, []
    if control:
        caps = ["users", "schedules", "persons"]
        if cfg.get("MIRROR_GATE_ACTIONS", "0") == "1" and ccfg["admin_pin"]:
            import mildura_commands as mc
            try:
                gate = mc.LocalGate(cfg.get("GATE_URL", "http://127.0.0.1:5000"), ccfg["admin_pin"])
                caps += ["gate.open", "gate.lockdown"]
            except ValueError:
                log("GATE_URL must be loopback; gate actions disabled")
    state = load_state(state_path)
    delay, cdelay = INTERVAL_S, COMMAND_INTERVAL_S
    next_sync = next_cmd = time.monotonic()
    log("started v%s (control %s, gate actions %s)" % (VERSION, "on" if control else "off", "on" if gate else "off"))
    while True:
        now = time.monotonic()
        if now >= next_sync:
            try:
                more = cycle(db_path, url, creds, state, state_path, status_url, caps)
                delay = 1 if more else INTERVAL_S
            except (urllib.error.URLError, OSError, RuntimeError, ValueError, sqlite3.Error) as e:
                delay = min(BACKOFF_MAX_S, max(delay, INTERVAL_S) * 2)
                log("sync failed (%s); retry in %ds" % (type(e).__name__, delay))
            next_sync = time.monotonic() + delay
        if control and now >= next_cmd:
            try:
                if command_cycle(db_path, url, creds, key_path, state, state_path, ccfg, gate):
                    next_sync = time.monotonic()          # show the change in the portal straight away
                cdelay = COMMAND_INTERVAL_S
            except (urllib.error.URLError, OSError, RuntimeError, ValueError, sqlite3.Error, subprocess_error()) as e:
                cdelay = min(300, cdelay * 2)
                log("commands failed (%s); retry in %ds" % (type(e).__name__, cdelay))
            next_cmd = time.monotonic() + cdelay
        time.sleep(max(0.5, min(next_sync, next_cmd if control else next_sync) - time.monotonic()))


def subprocess_error():
    import subprocess
    return subprocess.SubprocessError


if __name__ == "__main__":
    sys.exit(main())
