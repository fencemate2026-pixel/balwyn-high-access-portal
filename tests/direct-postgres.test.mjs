// Direct PostgreSQL path (Azure), 6 Nov 2026. runStatements is exercised on real
// PostgreSQL semantics (PGlite) with the production migrations applied. The
// node-postgres pool wrapper itself is NOT covered here: it needs a live server.
import assert from "node:assert/strict";
import test from "node:test";
import { databaseFixture } from "./auth-fixture.mjs";
import { runStatements } from "../db/run-statements.ts";
import { assertValidStatements, batchWrites, hasStackedStatement } from "../db/statement-guard.ts";

async function connection(t) {
  const { pg } = await databaseFixture(t);
  await pg.exec("RESET ROLE"); // runStatements switches to balwyn_app itself, as the production path does
  return { pg, connection: { async query(text, values) {
    const r = await pg.query(text, values ?? [], { rowMode: "array" });
    return { rows: r.rows, columns: r.fields.map((f) => f.name), count: r.affectedRows ?? 0 };
  } } };
}
const s = (sql, params = []) => ({ sql, params });

test("runs as the restricted role, returns rows, columns and ISO timestamps", async (t) => {
  const { connection: c } = await connection(t);
  const [result] = await runStatements(c, [s("SELECT current_user AS who, now() AS at, 42::bigint AS big")]);
  assert.deepEqual(result.columns, ["who", "at", "big"]);
  assert.equal(result.rows[0][0], "balwyn_app");
  assert.match(String(result.rows[0][1]), /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.equal(typeof result.rows[0][2] === "string" || typeof result.rows[0][2] === "number", true);
});

test("a write batch persists, and rolls back completely when a later statement fails", async (t) => {
  const { connection: c } = await connection(t);
  await runStatements(c, [s("INSERT INTO auth_attempts (fingerprint,success) VALUES ($1,0)", ["kept"])]);
  await assert.rejects(runStatements(c, [s("INSERT INTO auth_attempts (fingerprint,success) VALUES ($1,0)", ["gone"]), s("SELECT 1/0")]));
  const [[rows]] = [await runStatements(c, [s("SELECT fingerprint FROM auth_attempts ORDER BY fingerprint")])];
  assert.deepEqual(rows.rows, [["kept"]]);
});

test("the application role cannot reach other applications' data", async (t) => {
  const { connection: c } = await connection(t);
  await assert.rejects(runStatements(c, [s("SELECT * FROM storage.buckets")]), /permission denied/);
});

test("the guard refuses everything the Edge Function refused", () => {
  const refused = [
    [s("DROP TABLE auth_attempts")],
    [s("SELECT 1; RESET ROLE")],
    [s("SELECT set_config('role','postgres',false)")],
    [s("SELECT pg_advisory_lock(1)")],
    [s("SELECT pg_sleep(5)")],
    [s("SELECT $$x$$")],
    [s("SELECT $1", [{}])],
    [s("SELECT $1", [undefined])],
    [],
    Array.from({ length: 101 }, () => s("SELECT 1")),
  ];
  for (const batch of refused) assert.throws(() => assertValidStatements(batch), /Invalid database request/);
  assert.doesNotThrow(() => assertValidStatements([s("SELECT ';' AS semi, 'it''s' AS q -- ; comment")]));
  assert.equal(hasStackedStatement("SELECT 1"), false);
  assert.equal(batchWrites([s("SELECT 1")]), false);
  assert.equal(batchWrites([s("SELECT 1"), s("  update x set a=1")]), true);
});
