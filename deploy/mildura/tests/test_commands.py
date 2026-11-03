"""Tests for pi/mildura_commands.py (Phase 2 applier) and the command loop in mildura_mirror.py.
Runs against a fixture copy of the gate app schema; real RSA-OAEP via the openssl CLI."""
import base64, json, os, shutil, sqlite3, subprocess, sys, tempfile, unittest, uuid
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import mildura_commands as mc
import mildura_mirror as m

SCHEMA = """
create table users(id integer primary key autoincrement,name text not null,pin text unique not null,enabled integer default 1,
  schedule_type text default 'always',schedule_data text,created_at timestamp default current_timestamp);
create table auto_schedules(id integer primary key autoincrement,name text,days text,open_time text,close_time text,
  enabled integer default 1,created_at timestamp default current_timestamp,close_day integer);
create table auth_persons(id integer primary key autoincrement,name text,role text,phone text,pin text);
create table access_log(id integer primary key autoincrement,user_name text,method text,success integer,timestamp timestamp default current_timestamp);
create table changes_log(id integer primary key autoincrement,timestamp timestamp default current_timestamp,action text,detail text,changed_by text,synced integer default 0);
create table settings(key text primary key,value text);
"""
HAVE_OPENSSL = shutil.which("openssl") is not None


def fixture_db(path):
    c = sqlite3.connect(path); c.executescript(SCHEMA)
    c.execute("insert into users(name,pin) values('Alice Staff','482913')")
    c.execute("insert into users(name,pin,enabled,schedule_type,schedule_data) values('Bob Staff','775201',0,'business_hours',?)",
              (json.dumps({"days": [0, 1, 2, 3, 4], "start": "08:00", "end": "17:00"}),))
    c.execute("insert into auto_schedules(name,days,open_time,close_time) values('Club open','[0,1,2,3,4]','10:00','23:00')")
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

    def run1(self, c):
        return mc.apply_all(self.db, [c], self.key)[0]

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
            ("user.update", {"local_id": 2, "schedule_type": "business_hours", "schedule_data": json.dumps({"days": [5], "start": "09:00", "end": "12:00"})}, None),
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
        self.assertEqual(self.q("select name,days,enabled from auto_schedules"), [("Weekend", "[5, 6]", 1)])
        self.assertEqual(self.q("select name,phone,pin from auth_persons"), [("Eve", "0411222333", "909090")])
        self.assertEqual(len(self.q("select 1 from changes_log where changed_by like 'portal:%'")), len(steps))

    def test_days_follow_existing_csv_format(self):
        c = sqlite3.connect(self.db); c.execute("update auto_schedules set days='0,1,2'"); c.commit(); c.close()
        self.run1(self.cmd("schedule.add", {"name": "Late", "days": [4], "open_time": "18:00", "close_time": "02:00", "close_day": 5}))
        self.assertEqual(self.q("select days,close_day from auto_schedules where name='Late'"), [("4", 5)])

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
        R(self.cmd("user.add", {"name": "X"}, {"pin": "111222"}), "already in use")          # an authorised person's PIN
        R(self.cmd("user.add", {"name": ""}, {"pin": "555123"}), "name")
        R(self.cmd("user.add", {"name": "Bad\x07"}, {"pin": "555123"}), "name")
        R(self.cmd("user.add", {"name": "PIN 555123"}, {"pin": "555124"}), "digit")
        R(self.cmd("user.add", {"name": "NoPin"}), "sealed PIN")
        R(self.cmd("user.add", {"name": "Plain", "pin": "555123"}), "plaintext")
        R(self.cmd("user.add", {"name": "X", "schedule_type": "night_shift", "schedule_data": "{}"}, {"pin": "555123"}), "not used on this Pi")
        R(self.cmd("user.update", {"local_id": 2, "schedule_type": "business_hours", "schedule_data": json.dumps({"other": 1})}), "format")
        R(self.cmd("user.update", {"local_id": 99, "name": "Ghost"}), "no longer exists")
        R(self.cmd("user.update", {"local_id": 1}), "nothing to change")
        R(self.cmd("user.delete", {"local_id": "1"}), "positive integer")
        R(self.cmd("user.enable", {"local_id": 1, "enabled": 1}), "true or false")
        R(self.cmd("schedule.add", {"name": "S", "days": [], "open_time": "09:00", "close_time": "10:00"}), "days")
        R(self.cmd("schedule.add", {"name": "S", "days": [7], "open_time": "09:00", "close_time": "10:00"}), "days")
        R(self.cmd("schedule.add", {"name": "S", "days": [1], "open_time": "9am", "close_time": "10:00"}), "HH:MM")
        R(self.cmd("schedule.add", {"name": "S", "days": [1], "open_time": "10:00", "close_time": "10:00"}), "same")
        R(self.cmd("person.add", {"name": "P"}, {"phone": "abc"}), "phone")
        R(self.cmd("users.enable_all", {"enabled": True}, actor=""), "actor")
        R(self.cmd("delete.everything"), "unknown command kind")
        for k in mc.GATE_KINDS:
            R(self.cmd(k), "not_supported")

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
        c2 = self.cmd("users.enable_all", {"enabled": False}); c2["seq"] = 1
        acks = mc.apply_all(self.db, [c1, c2], self.key)
        self.assertEqual([x["id"] for x in acks], [c2["id"], c1["id"]])
        self.assertEqual(self.q("select distinct enabled from users"), [(1,)])

    def test_busy_database_is_not_acked(self):
        hold = sqlite3.connect(self.db, isolation_level=None); hold.execute("BEGIN EXCLUSIVE")
        try:
            orig = mc.open_rw
            mc.open_rw = lambda p: (lambda c: (c.execute("PRAGMA busy_timeout=50"), c)[1])(sqlite3.connect(p, timeout=0.05, isolation_level=None))
            acks = mc.apply_all(self.db, [self.cmd("users.enable_all", {"enabled": True})], self.key)
        finally:
            mc.open_rw = orig; hold.execute("ROLLBACK"); hold.close()
        self.assertEqual(acks, [])                                   # cloud keeps it and re-delivers

    # -- the command loop in mildura_mirror.py --------------------------------------------
    def test_command_cycle_registers_key_applies_and_acks(self):
        sent = []
        c = self.cmd("user.add", {"name": "Loop User"}, {"pin": "864209"})
        def fake_post(url, body):
            sent.append(body)
            if body["action"] == "key": return {"ok": True, "registered": True}
            if body["action"] == "commands": return {"ok": True, "commands": [c]}
            return {"ok": True}
        orig = m.post; m.post = fake_post
        try:
            st = {}; sp = os.path.join(self.d, "s.json")
            n = m.command_cycle(self.db, "https://x.invalid", {"device_id": "mildura-001", "secret": "s" * 40}, self.key, st, sp)
        finally:
            m.post = orig
        self.assertEqual(n, 1)
        self.assertEqual([b["action"] for b in sent], ["key", "commands", "ack"])
        self.assertIn("BEGIN PUBLIC KEY", sent[0]["pubkey"]); self.assertNotIn("PRIVATE", json.dumps(sent))
        self.assertEqual(sent[2]["results"][0]["ok"], True)
        self.assertNotIn("864209", json.dumps(sent[2]))
        self.assertTrue(st["key_registered"])

    def test_command_cycle_refuses_when_cloud_has_other_key(self):
        orig = m.post; m.post = lambda url, body: {"ok": True, "registered": False}
        try:
            with self.assertRaises(RuntimeError):
                m.command_cycle(self.db, "https://x.invalid", {"device_id": "d", "secret": "s" * 40}, self.key, {}, os.path.join(self.d, "s.json"))
        finally:
            m.post = orig

    def test_mirror_read_path_still_read_only(self):
        con = m.open_ro(self.db)
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("delete from users")
        con.close()


if __name__ == "__main__":
    unittest.main()
