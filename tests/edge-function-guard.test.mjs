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
// STACKED_STATEMENT_PATTERN has no /i flag, so it doesn't match pattern()'s
// `/.../i);` extraction regex — pull it out directly instead.
const stackedMatch = source.match(/const STACKED_STATEMENT_PATTERN = (\/.*\/);/);
assert.ok(stackedMatch, "STACKED_STATEMENT_PATTERN not found");
const stacked = new Function(`return ${stackedMatch[1]}`)();
// Mirrors index.ts's own use of the pattern: trim exactly one trailing
// semicolon first, then test what's left for an embedded one.
const isStacked = (sql) => stacked.test(sql.replace(/;\s*$/, ""));

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
    "SELECT 1;", // one trailing semicolon is fine
    "SELECT 1;  ", // ...even with trailing whitespace after it
  ]) { assert.ok(allowed.test(sql), sql); assert.ok(!forbidden.test(sql), sql); assert.ok(!isStacked(sql), sql); }
});

test("DB audit P1-1: a stacked second statement is rejected regardless of protocol stacking behaviour", () => {
  // Each of these starts with a leading SELECT/INSERT/etc (passes
  // ALLOWED_PATTERN) and never writes the forbidden function's name as a
  // literal substring (so FORBIDDEN_PATTERN alone would miss it) — exactly
  // the bypass AUDIT_DB.md P1-1 describes. STACKED_STATEMENT_PATTERN must
  // catch every one of them.
  for (const sql of [
    "SELECT 1; DO $$ BEGIN EXECUTE 'SELECT pg_sl'||'eep(10)'; END $$;",
    "SELECT 1; SELECT 2",
    "INSERT INTO t(a) VALUES (1); DROP TABLE t",
    "SELECT 1; -- trailing comment after a second statement boundary",
  ]) assert.ok(isStacked(sql), sql);
});

test("DB audit P2-6: pg_terminate_backend/pg_cancel_backend/COPY are forbidden", () => {
  for (const sql of [
    "SELECT pg_terminate_backend(123)",
    "SELECT pg_cancel_backend(123)",
    "COPY t TO '/tmp/x'",
    "SELECT * FROM t; COPY t FROM PROGRAM 'cat /etc/passwd'",
  ]) assert.ok(forbidden.test(sql) || isStacked(sql), sql);
});
