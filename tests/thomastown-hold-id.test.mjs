// Azure node-postgres returns a bigint local_id as a string. Number.isSafeInteger("1")
// is false, so Turn off throws "Unknown entry." before a command is queued.
// local_id::int uses the int4 parser, which returns a number the command accepts.
// PGlite already returns numbers, so the other hold tests do not catch this.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { types } from "pg";

test("hold and caller ids are selected as int so Turn off is not Unknown entry", () => {
  const fromBigint = types.getTypeParser(20);
  const fromInt = types.getTypeParser(23);
  const raw = fromBigint("1");
  assert.equal(typeof raw, "string");
  assert.equal(Number.isSafeInteger(raw), false);
  const asInt = fromInt("1");
  assert.equal(asInt, 1);
  assert.equal(Number.isSafeInteger(asInt), true);

  const src = readFileSync(new URL("../lib/gd-swing-store.ts", import.meta.url), "utf8");
  const detail = src.slice(src.indexOf("export async function getDetail"), src.indexOf("export async function listCommands"));
  for (const table of ["gd.users", "gd.hold_windows", "gd.access_log", "gd.changes"]) {
    const at = detail.indexOf(table);
    assert.ok(at > 0, table);
    assert.match(detail.slice(Math.max(0, at - 220), at), /local_id::int AS local_id/);
  }
});
