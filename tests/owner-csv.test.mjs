// CSV helpers for the owner sites (4 Nov 2026): export is safe to open in a spreadsheet, import is forgiving.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const csv = await vite.ssrLoadModule("/lib/owner-csv.ts");

test("export neutralises spreadsheet formulas and quotes awkward cells", () => {
  assert.equal(csv.csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csv.csvCell("+61400101132"), "'+61400101132");
  assert.equal(csv.csvCell("a,b"), "\"a,b\"");
  assert.equal(csv.csvCell(null), "");
  assert.equal(csv.toCsv(["Name", "Mobile"], [["Ann", "0411 222 333"]]), "Name,Mobile\r\nAnn,0411 222 333\r\n");
});

test("parser handles quotes, doubled quotes, CRLF, BOM and blank lines", () => {
  const rows = csv.parseCsv("﻿Name,Mobile\r\n\"Smith, Ann\",0411 222 333\r\n\r\n\"Say \"\"hi\"\"\",0422333444");
  assert.deepEqual(rows, [["Name", "Mobile"], ["Smith, Ann", "0411 222 333"], ["Say \"hi\"", "0422333444"]]);
});

test("whitelist import reads a header or none, skips bad and repeated lines and says why", () => {
  const withHeader = csv.parseWhitelistCsv("Name,Mobile,Unit,Status\nAnn,0411 222 333,Unit 1,Active\n,0422333444,,\nBob,0411222333,Unit 2,Active\nCy,0433 444 555,,Disabled");
  assert.deepEqual(withHeader.rows, [{ name: "Ann", phone: "0411 222 333", unitLabel: "Unit 1" }, { name: "Cy", phone: "0433 444 555", unitLabel: "" }]);
  assert.equal(withHeader.problems.length, 2);
  assert.match(withHeader.problems[0], /^Line 3: name and mobile are both required/);
  assert.match(withHeader.problems[1], /^Line 4: Bob repeats a number/);
  const noHeader = csv.parseWhitelistCsv("Ann,0411 222 333,Unit 1");
  assert.deepEqual(noHeader.rows, [{ name: "Ann", phone: "0411 222 333", unitLabel: "Unit 1" }]);
  assert.deepEqual(csv.parseWhitelistCsv("").problems, ["The file is empty."]);
  assert.equal(csv.parseWhitelistCsv("Name,Phone\nA,0411222333\nB,0422333444", 1).rows.length, 1);
});

test("an exported file imports back unchanged", () => {
  const out = csv.toCsv(["Name", "Mobile", "Unit"], [["O'Brien, Pat", "0411 222 333", "=Unit 1"]]);
  assert.deepEqual(csv.parseWhitelistCsv(out).rows, [{ name: "O'Brien, Pat", phone: "0411 222 333", unitLabel: "=Unit 1" }]);
});
