"""Tests for pi/mildura_mirror.py. Run: python3 -m unittest discover -s deploy/mildura/tests
Fake gate databases in both known schema generations; a fake cloud via monkeypatched post()."""
import json, os, sqlite3, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import mildura_mirror as m

PIN_A, PIN_B, FAIL_PIN = "482913", "775201", "908172"

def make_db(path, new_schema):
    c = sqlite3.connect(path)
    c.executescript("""
      create table users(id integer primary key autoincrement,name text not null,pin text unique not null,
        enabled integer default 1,schedule_type text default 'always',schedule_data text,created_at timestamp default current_timestamp);
      create table auto_schedules(id integer primary key autoincrement,name text,days text,open_time text,close_time text,enabled integer default 1,created_at timestamp default current_timestamp);
      create table auth_persons(id integer primary key autoincrement,name text,role text,phone text,pin text);
      create table changes_log(id integer primary key autoincrement,action text,detail text,changed_by text,timestamp timestamp default current_timestamp%s);
      create table access_log(id integer primary key autoincrement,user_name text,method text default 'pin',success integer,timestamp timestamp default current_timestamp%s);
    """ % ((", synced integer default 0",) * 2 if new_schema else ("", "")))
    if new_schema:
        c.execute("alter table access_log add column attempted_pin text")
    c.execute("insert into users(name,pin) values('Alice Staff',?)", (PIN_A,))
    c.execute("insert into users(name,pin,enabled) values('Bob Staff',?,0)", (PIN_B,))
    c.execute("insert into auth_persons(name,role,phone,pin) values('Carol','Manager','0400000000',?)", (PIN_A,))
    c.execute("insert into changes_log(action,detail,changed_by) values('ADD_USER',?, 'Admin')", ("added Alice with pin " + PIN_A,))
    c.execute("insert into access_log(user_name,method,success) values('Alice Staff','web',1)")
    if new_schema:
        c.execute("insert into access_log(user_name,method,success,attempted_pin) values('—','web',0,?)", (FAIL_PIN,))
    else:
        c.execute("insert into access_log(user_name,method,success) values('—','web',0)")
    c.commit(); c.close()

class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.state_path = os.path.join(self.d, "state.json")
        self.creds = {"device_id": "mildura-001", "secret": "x" * 40}
        self.sent = []
        self._post = m.post
        self.ok = True
        def fake_post(url, body):
            self.sent.append(json.loads(json.dumps(body, default=str)))
            return {"ok": True} if self.ok else {"ok": False, "error": "no"}
        m.post = fake_post
        m.local_status = lambda url: {"lockdown": False}
    def tearDown(self):
        m.post = self._post

    def run_cycle(self, db, state):
        return m.cycle(db, "https://example.invalid", self.creds, state, self.state_path, "")

    def both_schemas(self):
        for new in (False, True):
            db = os.path.join(self.d, "g%d.db" % new); make_db(db, new)
            yield new, db

    def test_only_recorded_event_pin_leaves_the_pi(self):
        for new, db in self.both_schemas():
            self.sent.clear(); st = {}
            self.run_cycle(db, st)
            blob = json.dumps(self.sent)
            for pin in (PIN_A, PIN_B):
                self.assertNotIn(pin, blob, "schema new=%s leaked a PIN" % new)
            attempts = self.sent[0]["streams"]["access_log"]
            if new:
                self.assertEqual(attempts[1]["attempted_pin"], FAIL_PIN)
            else:
                self.assertNotIn("attempted_pin", blob)
            self.assertNotIn('"pin"', blob)
            self.assertNotIn("0400000000", blob)   # auth_persons.phone is not allowlisted

    def test_access_pin_backfill_starts_from_zero_and_advances_only_after_ack(self):
        db = os.path.join(self.d, "backfill.db"); make_db(db, True)
        st = {"stream": {"access_log": 999}}
        self.ok = False
        with self.assertRaises(RuntimeError): self.run_cycle(db, st)
        self.assertEqual(st, {"stream": {"access_log": 999}})
        self.ok = True
        self.run_cycle(db, st)
        self.assertEqual(len(self.sent[-1]["streams"]["access_log"]), 2)
        self.assertEqual(st["stream"]["access_log"], 2)
        self.assertTrue(st["access_pin_sync_v1"])

    def test_entered_pin_preserves_leading_zeros_and_never_uses_current_user_pin(self):
        db = os.path.join(self.d, "leading.db"); make_db(db, True)
        con = sqlite3.connect(db)
        con.execute("UPDATE access_log SET attempted_pin='001234' WHERE success=1")
        con.commit(); con.close()
        self.run_cycle(db, {})
        self.assertEqual(self.sent[-1]["streams"]["access_log"][0]["attempted_pin"], "001234")
        self.assertNotIn(PIN_A, json.dumps(self.sent))

    def test_rows_are_sent(self):
        for new, db in self.both_schemas():
            self.sent.clear(); self.run_cycle(db, {})
            p = self.sent[0]
            self.assertEqual([u["name"] for u in p["snapshots"]["users"]], ["Alice Staff", "Bob Staff"])
            self.assertEqual(len(p["streams"]["access_log"]), 2)
            self.assertEqual(p["streams"]["changes_log"][0]["detail"], "added Alice with pin ####")

    def test_marks_advance_only_after_ack_and_resend_is_empty(self):
        _, db = next(self.both_schemas())
        st = {}
        self.ok = False
        with self.assertRaises(RuntimeError): self.run_cycle(db, st)
        self.assertEqual(st, {})                       # nothing advanced on refusal
        self.ok = True; self.run_cycle(db, st)
        self.sent.clear(); self.run_cycle(db, st)       # nothing new -> nothing to send
        self.assertEqual(self.sent[0]["snapshots"], {}); self.assertEqual(self.sent[0]["streams"], {})

    def test_new_row_is_picked_up(self):
        _, db = next(self.both_schemas()); st = {}
        self.run_cycle(db, st)
        c = sqlite3.connect(db); c.execute("insert into access_log(user_name,method,success) values('Alice Staff','web',1)"); c.commit(); c.close()
        self.sent.clear(); self.run_cycle(db, st)
        self.assertEqual(len(self.sent[0]["streams"]["access_log"]), 1)

    def test_database_is_opened_read_only(self):
        _, db = next(self.both_schemas())
        con = m.open_ro(db)
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("insert into users(name,pin) values('x','1')")
        con.close()

    def test_missing_optional_tables_do_not_crash(self):
        db = os.path.join(self.d, "min.db")
        c = sqlite3.connect(db); c.execute("create table users(id integer primary key,name text,pin text)"); c.execute("insert into users values(1,'Z','123456')"); c.commit(); c.close()
        con = m.open_ro(db)
        self.assertEqual(m.read_snapshot(con, "auto_schedules"), [])
        self.assertEqual(m.read_stream(con, "access_log", 0), [])
        self.assertEqual(m.read_snapshot(con, "users"), [{"id": 1, "name": "Z"}])
        con.close()

    def test_state_file_roundtrip_is_atomic(self):
        p = os.path.join(self.d, "s.json"); m.save_state(p, {"a": 1}); self.assertEqual(m.load_state(p), {"a": 1})
        self.assertFalse(os.path.exists(p + ".tmp"))

if __name__ == "__main__":
    unittest.main()

