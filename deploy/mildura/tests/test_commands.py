"""Tests for pi/mildura_commands.py (Phase 2 applier) and the command loop in mildura_mirror.py.
Fixture = the gate app's own init_db() schema (Milduraworkingmansclub main @ 44947f1) plus the
close_day column seen on the live Pi; real RSA-OAEP via the openssl CLI; a fake gate app on
loopback that implements /login, /gate/open, /lockdown and the retired /hold_open like app.py."""
import base64, json, os, shutil, sqlite3, subprocess, sys, tempfile, threading, unittest, uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import mildura_commands as mc
import mildura_mirror as m

SCHEMA = """
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin TEXT UNIQUE NOT NULL, enabled INTEGER DEFAULT 1,
  schedule_type TEXT DEFAULT 'always', schedule_data TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE auto_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, days TEXT NOT NULL, open_time TEXT NOT NULL,
  close_time TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, close_day INTEGER);
CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT, method TEXT DEFAULT 'pin', success INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, synced INTEGER DEFAULT 0, attempted_pin TEXT);
CREATE TABLE changes_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, detail TEXT, changed_by TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, synced INTEGER DEFAULT 0);
CREATE TABLE auth_persons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT, phone TEXT, pin TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE keypad_frame_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, event TEXT NOT NULL, path TEXT, raw_bits TEXT,
  bit_count INTEGER, decoded_pin TEXT, matched_pin TEXT, candidates TEXT, granted INTEGER, pulsed INTEGER, user_name TEXT, detail TEXT);
"""
ADMIN = "918273"


def fake_gate_app(db, admin_pin=ADMIN, auto_open=None):
    """Loopback stand-in for the LIVE app.py admin routes, writing the DB the same way the app does.
    auto_open: dict({"on": bool}) - simulates an active auto_schedules window (db.is_auto_open())."""
    hits = []
    auto_open = auto_open if auto_open is not None else {"on": False}
    manual = {"hold": False}
    def lockdown():
        c = sqlite3.connect(db)
        try: return (c.execute("select value from settings where key='lockdown'").fetchone() or ("0",))[0] == "1"
        finally: c.close()
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            hits.append((self.path, None))
            if self.path != "/api/status":
                self.send_response(404); self.end_headers(); return
            body = json.dumps({"auto_open": auto_open["on"], "auto_name": "Club open" if auto_open["on"] else None,
                               "hold": manual["hold"], "signal_on": manual["hold"], "manual_hold": manual["hold"],
                               "lockdown": lockdown(), "gpio": True}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
        def _go(self, loc, cookie=None):
            self.send_response(302); self.send_header("Location", loc)
            if cookie: self.send_header("Set-Cookie", cookie)
            self.end_headers()
        def do_POST(self):
            form = parse_qs(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode())
            hits.append((self.path, self.headers.get("Origin")))
            if self.headers.get("Origin") not in (None, "http://%s" % self.headers.get("Host")):
                self.send_response(403); self.end_headers(); return
            authed = "session=admin" in (self.headers.get("Cookie") or "")
            if self.path == "/login":
                return self._go("/", "session=admin; HttpOnly") if form.get("pin", [""])[0] == admin_pin else (self.send_response(200), self.end_headers())
            if not authed:
                return self._go("/login?next=" + self.path)
            c = sqlite3.connect(db)
            try:
                if self.path == "/gate/open":
                    if auto_open["on"]:                      # live app: flash + redirect, nothing logged
                        return self._go("/")
                    paused = lockdown()
                    c.execute("insert into access_log(user_name,method,success) values('REMOTE',?,?)", ("dashboard-no-pulse", 0) if paused else ("dashboard", 1))
                elif self.path == "/lockdown":
                    c.execute("insert or replace into settings(key,value) values('lockdown',?)", ("1" if form.get("state", [""])[0] == "on" else "0",))
                elif self.path == "/hold_open":            # live: toggles in-memory ORO hold (wire is disconnected)
                    manual["hold"] = not manual["hold"]
                c.commit()
            finally:
                c.close()
            self._go("/")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, hits
HAVE_OPENSSL = shutil.which("openssl") is not None


def fixture_db(path):
    c = sqlite3.connect(path); c.executescript(SCHEMA)
    c.execute("insert into users(name,pin) values('Alice Staff','482913')")
    c.execute("insert into users(name,pin,enabled,schedule_type,schedule_data) values('Bob Staff','775201',0,'time_range',?)",
              (json.dumps({"days": [0, 1, 2, 3, 4], "start": "08:00", "end": "17:00"}),))
    c.execute("insert into auto_schedules(name,days,open_time,close_time) values('Club open','[0, 1, 2, 3, 4]','10:00','23:00')")
    c.execute("insert into auth_persons(name,role,phone,pin) values('Carol','Manager','0400000000','111222')")
    c.commit(); c.close()


def seal(pub_path, secrets, cid):
    """Encrypt exactly as the portal does (RSA-OAEP, SHA-256, MGF1-SHA-256)."""
    p = subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", pub_path, "-pkeyopt", "rsa_padding_mode:oaep",
                        "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256"],
                       input=json.dumps(dict(secrets, cmd=cid)).encode(), capture_output=True, check=True)
    return base64.b64encode(p.stdout).decode()


@unittest.skipUnless(HAVE_OPENSSL, "openssl CLI required")
class ApplierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kd = tempfile.mkdtemp()
        cls.key = os.path.join(cls.kd, "k.pem"); cls.pub = os.path.join(cls.kd, "p.pem")
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", cls.key], check=True, capture_output=True)
        with open(cls.pub, "w") as fh: fh.write(mc.public_key_pem(cls.key))

    def setUp(self):
        self.d = tempfile.mkdtemp(); self.db = os.path.join(self.d, "boom_gate.db"); fixture_db(self.db)

    def cmd(self, kind, args=None, secrets=None, actor="owner@example.test"):
        cid = str(uuid.uuid4())
        return {"id": cid, "seq": 1, "kind": kind, "args": args or {}, "actor_email": actor,
                "sealed": seal(self.pub, secrets, cid) if secrets is not None else None}

    def run1(self, c, gate=None):
        return mc.apply_all(self.db, [c], self.key, cfg={"admin_pin": ADMIN, "verify_s": 2}, gate=gate)[0]

    def q(self, sql, *a):
        c = sqlite3.connect(self.db); r = c.execute(sql, a).fetchall(); c.close(); return r

    # -- happy paths ---------------------------------------------------------------------
    def test_user_add_writes_pin_and_audits_without_it(self):
        a = self.run1(self.cmd("user.add", {"name": "Dan New"}, {"pin": "135790"}))
        self.assertTrue(a["ok"], a)
        self.assertEqual(self.q("select name,pin,enabled,schedule_type from users where id=?", a["result"]["local_id"]), [("Dan New", "135790", 1, "always")])
        log = self.q("select action,detail,changed_by,synced from changes_log")[-1]
        self.assertEqual((log[0], log[2], log[3]), ("ADD_USER", "portal:owner@example.test", 0))
        self.assertNotIn("135790", json.dumps(a)); self.assertNotIn("135790", log[1])

    def test_full_set_of_kinds(self):
        steps = [
            ("user.update", {"local_id": 1, "name": "Alice B"}, {"pin": "246802"}),
            ("user.update", {"local_id": 2, "schedule_type": "time_range", "schedule_data": json.dumps({"end": "01:00", "start": "18:00", "days": [5, 4]})}, None),
            ("user.enable", {"local_id": 2, "enabled": True}, None),
            ("users.enable_all", {"enabled": False}, None),
            ("schedule.add", {"name": "Weekend", "days": [6, 5], "open_time": "09:00", "close_time": "23:30"}, None),
            ("schedule.enable", {"local_id": 1, "enabled": False}, None),
            ("person.add", {"name": "Eve", "role": "Treasurer"}, {"phone": "0411 222 333", "pin": "909090"}),
            ("person.delete", {"local_id": 1}, None),
            ("schedule.delete", {"local_id": 1}, None),
            ("user.delete", {"local_id": 1}, None),
        ]
        for kind, args, sec in steps:
            a = self.run1(self.cmd(kind, args, sec)); self.assertTrue(a["ok"], (kind, a))
        self.assertEqual(self.q("select id,enabled from users"), [(2, 0)])
        self.assertEqual(self.q("select name,days,enabled,close_day from auto_schedules"), [("Weekend", "[5, 6]", 1, None)])
        self.assertEqual(self.q("select name,role,phone,pin from auth_persons"), [("Eve", "Treasurer", "0411 222 333", "909090")])
        # canonical app format, key order days,start,end as app.add_user json.dumps
        self.assertEqual(self.q("select schedule_type,schedule_data from users where id=2"), [("time_range", '{"days": [4, 5], "start": "18:00", "end": "01:00"}')])
        self.assertEqual(len(self.q("select 1 from changes_log where changed_by like 'portal:%'")), len(steps))

    def test_formats_match_the_gate_app(self):
        self.run1(self.cmd("schedule.add", {"name": "Late", "days": [4], "open_time": "18:00", "close_time": "02:00", "close_day": 5}))
        self.assertEqual(self.q("select days,close_day from auto_schedules where name='Late'"), [("[4]", None)])   # close_day never written
        a = self.run1(self.cmd("person.add", {"name": "NoExtras"}))
        self.assertTrue(a["ok"], a)
        role, phone, pin = self.q("select role,phone,pin from auth_persons where name='NoExtras'")[0]
        self.assertEqual((role, phone), ("", ""))
        self.assertRegex(pin, r"^[1-9]\d{3}$"); self.assertNotIn(pin, json.dumps(a))   # generated like the app, never reported
        self.assertEqual(self.q("select action from changes_log order by id desc limit 1"), [("AUTH_PERSON",)])
        a = self.run1(self.cmd("user.add", {"name": "Ranged", "schedule_type": "time_range", "schedule_data": json.dumps({"days": [0], "start": "07:00", "end": "15:30"})}, {"pin": "556677"}))
        self.assertTrue(a["ok"], a)
        self.assertEqual(self.q("select schedule_data from users where name='Ranged'"), [('{"days": [0], "start": "07:00", "end": "15:30"}',)])
        log = self.q("select action,changed_by,synced,timestamp is not null from changes_log order by id desc limit 1")[0]
        self.assertEqual(log, ("ADD_USER", "portal:owner@example.test", 0, 1))

    def test_leading_zero_pins_like_the_live_app(self):
        self.assertTrue(self.run1(self.cmd("user.add", {"name": "Zero Lead"}, {"pin": "012345"}))["ok"])
        self.assertEqual(self.q("select pin from users where name='Zero Lead'"), [("012345",)])
        # has_access() treats 12345 and 012345 as the same PIN, so the second is refused
        self.assertRejected(self.cmd("user.add", {"name": "Clash"}, {"pin": "12345"}), "leading zeros")
        self.assertTrue(self.run1(self.cmd("schedule.add", {"name": "Late", "days": [5], "open_time": "18:00", "close_time": "02:00"}))["ok"])

    # -- idempotency ---------------------------------------------------------------------
    def test_redelivered_command_is_not_applied_twice(self):
        c = self.cmd("user.add", {"name": "Once Only"}, {"pin": "123987"})
        self.assertTrue(self.run1(c)["ok"])
        again = self.run1(c)
        self.assertEqual(again, {"id": c["id"], "ok": True, "result": {"already_applied": True}})
        self.assertEqual(len(self.q("select 1 from users where name='Once Only'")), 1)
        t = self.cmd("users.enable_all", {"enabled": True})
        self.run1(t); self.run1(t)
        self.assertEqual(len(self.q("select 1 from changes_log where action='ENABLE_ALL'")), 1)

    # -- rejections ----------------------------------------------------------------------
    def assertRejected(self, c, needle):
        before = self.q("select count(*) from changes_log")
        snap = (self.q("select * from users"), self.q("select * from auto_schedules"), self.q("select * from auth_persons"))
        a = self.run1(c)
        self.assertFalse(a["ok"], a); self.assertIn(needle, a["error"])
        self.assertEqual(before, self.q("select count(*) from changes_log"))
        self.assertEqual(snap, (self.q("select * from users"), self.q("select * from auto_schedules"), self.q("select * from auth_persons")))
        return a

    def test_bad_commands_are_rejected_and_change_nothing(self):
        R = self.assertRejected
        R(self.cmd("user.add", {"name": "X"}, {"pin": "12"}), "4-6 digits")
        R(self.cmd("user.add", {"name": "X"}, {"pin": "1234567"}), "4-6 digits")
        R(self.cmd("user.add", {"name": "X"}, {"pin": "12a4"}), "4-6 digits")
        R(self.cmd("user.add", {"name": "X"}, {"pin": "482913"}), "already in use")          # another user's PIN
        R(self.cmd("user.add", {"name": "X"}, {"pin": ADMIN}), "reserved")
        R(self.cmd("user.add", {"name": ""}, {"pin": "555123"}), "name")
        R(self.cmd("user.add", {"name": "Bad\x07"}, {"pin": "555123"}), "name")
        R(self.cmd("user.add", {"name": "PIN 555123"}, {"pin": "555124"}), "digit")
        R(self.cmd("user.add", {"name": "NoPin"}), "sealed PIN")
        R(self.cmd("user.add", {"name": "Plain", "pin": "555123"}), "plaintext")
        R(self.cmd("user.add", {"name": "X", "schedule_type": "business_hours", "schedule_data": "{}"}, {"pin": "555123"}), "'always' or 'time_range'")
        R(self.cmd("user.update", {"local_id": 2, "schedule_type": "time_range", "schedule_data": json.dumps({"days": [1], "start": "08:00"})}), "days, start and end")
        R(self.cmd("user.update", {"local_id": 2, "schedule_type": "time_range", "schedule_data": json.dumps({"days": [8], "start": "08:00", "end": "09:00"})}), "days")
        R(self.cmd("user.update", {"local_id": 2, "schedule_type": "time_range", "schedule_data": json.dumps({"days": [1], "start": "08:00", "end": "08:00"})}), "same")
        R(self.cmd("user.update", {"local_id": 99, "name": "Ghost"}), "no longer exists")
        R(self.cmd("user.update", {"local_id": 1}), "nothing to change")
        R(self.cmd("user.delete", {"local_id": "1"}), "positive integer")
        R(self.cmd("user.enable", {"local_id": 1, "enabled": 1}), "true or false")
        R(self.cmd("schedule.add", {"name": "S", "days": [], "open_time": "09:00", "close_time": "10:00"}), "days")
        R(self.cmd("schedule.add", {"name": "S", "days": [7], "open_time": "09:00", "close_time": "10:00"}), "days")
        R(self.cmd("schedule.add", {"name": "S", "days": [1], "open_time": "9am", "close_time": "10:00"}), "HH:MM")
        R(self.cmd("schedule.add", {"name": "S", "days": [1], "open_time": "10:00", "close_time": "10:00"}), "same")
        R(self.cmd("person.add", {"name": "P"}, {"phone": "abc"}), "phone")
        R(self.cmd("person.add", {"name": "P"}, {"pin": "482913"}), "already used")
        R(self.cmd("schedule.add", {"name": "S", "days": [1], "open_time": "07:00", "close_time": "06:00"}), "16 h")
        R(self.cmd("users.enable_all", {"enabled": True}, actor=""), "actor")
        R(self.cmd("delete.everything"), "unknown command kind")
        R(self.cmd("gate.hold"), "disconnected")
        for k in mc.GATE_KINDS:                                       # no gate client configured -> refused
            R(self.cmd(k, {"on": True} if k == "gate.lockdown" else {}), "not enabled")

    def test_sealed_value_bound_to_its_command(self):
        a = self.cmd("user.add", {"name": "A1"}, {"pin": "135246"})
        b = self.cmd("user.add", {"name": "B1"}, {"pin": "999888"})
        b["sealed"] = a["sealed"]                                    # swapped ciphertext
        self.assertRejected(b, "different command")
        b["sealed"] = base64.b64encode(b"x" * 256).decode()          # garbage
        self.assertRejected(b, "could not be decrypted")
        b["sealed"] = "***"
        self.assertRejected(b, "base64")

    def test_bad_id_and_queue_order(self):
        self.assertEqual(mc.apply_all(self.db, [{"id": "nope", "kind": "user.delete"}], self.key)[0]["ok"], False)
        c1 = self.cmd("users.enable_all", {"enabled": True}); c1["seq"] = 2
        self.run1(self.cmd("user.enable", {"local_id": 2, "enabled": False}))
        c2 = self.cmd("users.enable_all", {"enabled": False}); c2["seq"] = 1
        acks = mc.apply_all(self.db, [c1, c2], self.key)
        self.assertEqual([x["id"] for x in acks], [c2["id"], c1["id"]])
        self.assertEqual(self.q("select distinct enabled from users"), [(1,)])

    def test_busy_database_is_not_acked(self):
        command = self.cmd("users.enable_all", {"enabled": True})
        hold = sqlite3.connect(self.db, isolation_level=None); hold.execute("BEGIN EXCLUSIVE")
        try:
            orig = mc.open_rw
            mc.open_rw = lambda p: (lambda c: (c.execute("PRAGMA busy_timeout=50"), c)[1])(sqlite3.connect(p, timeout=0.05, isolation_level=None))
            acks = mc.apply_all(self.db, [command], self.key)
            self.assertEqual(acks, [])   # leave the command queued for another poll
        finally:
            mc.open_rw = orig; hold.close()
        self.assertTrue(self.run1(command)["ok"])
        self.assertEqual(self.q("select distinct enabled from users"), [(1,)])

    def test_caps_are_reported_in_status(self):
        sent = []
        orig = m.post; m.post = lambda url, body: (sent.append(body), {"ok": True})[1]
        orig_ls = m.local_status; m.local_status = lambda url: {"lockdown": False}
        try:
            m.cycle(self.db, "https://x.invalid", {"device_id": "d", "secret": "s" * 40}, {}, os.path.join(self.d, "s.json"), "", ["gate.open", "users"])
        finally:
            m.post = orig; m.local_status = orig_ls
        status = sent[0]["status"]
        self.assertEqual(status.get("lockdown"), False)
        self.assertEqual(status.get("mirror_caps"), ["gate.open", "users"])
        self.assertIsInstance(status.get("health"), dict)   # health metrics are always attached
        self.assertNotIn(ADMIN, json.dumps(sent))

    def test_mirror_read_path_still_read_only(self):
        con = m.open_ro(self.db)
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("delete from users")
        con.close()


if __name__ == "__main__":
    unittest.main()

