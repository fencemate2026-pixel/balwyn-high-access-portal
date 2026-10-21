// The database edge function must refuse statements that could leave the balwyn_app
// role or stall the global writer lock (16 Oct 2026). The Deno file cannot be imported
// here, so the test reads its source, extracts the two patterns and checks them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../supabase/functions/balwyn-portal-db/index.ts", import.meta.url), "utf8");
const pattern = (name) => {
  const match = source.match(new RegExp(`const ${name} = (/.*/i);`));
  assert.ok(match, `${name} not found`);
  return new Function(`return ${match[1]}`)();
};
const forbidden = pattern("FORBIDDEN_PATTERN");
const allowed = pattern("ALLOWED_PATTERN");

test("the function rejects a statement that fails ALLOWED or matches FORBIDDEN", () => {
  assert.match(source, /!ALLOWED_PATTERN\.test\(s\.sql\) \|\| FORBIDDEN_PATTERN\.test\(s\.sql\)/);
});

test("role escape, lock stall and file-access calls are forbidden", () => {
  for (const sql of [
    "SELECT set_config('role', 'postgres', true)",
    "select SET_CONFIG('search_path','public',false)",
    "SELECT pg_advisory_lock(1)", "SELECT pg_advisory_xact_lock(672419830)",
    "SELECT pg_sleep(9)", "SELECT * FROM dblink('x','y') AS t(a int)",
    "SELECT pg_read_file('/etc/passwd')", "SELECT lo_import('/etc/passwd')",
    "UPDATE t SET a = (SELECT 1 FROM pg_ls_dir('.')) WHERE id = ?",
  ]) assert.ok(forbidden.test(sql), sql);
});

test("the portal's own statements are not affected", () => {
  for (const sql of [
    "SELECT id, email FROM portal_accounts WHERE lower(email) = ? LIMIT 1",
    "UPDATE portal_accounts SET active = COALESCE(?, active), role = COALESCE(?, role) WHERE id = ?",
    "INSERT INTO staff_ui_events (session_id, account_key, actor_name, kind, label, created_at) VALUES (?::uuid, ?, ?, 'press', ?, ?::timestamptz)",
    "DELETE FROM staff_presence WHERE started_at < ?::timestamptz",
    "SELECT count(*) AS n FROM portal_accounts WHERE active = true",
  ]) { assert.ok(allowed.test(sql), sql); assert.ok(!forbidden.test(sql), sql); }
});
