import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("excludes development preview metadata from the worker build", async () => {
  const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']codex-preview["']\s*:\s*["']development["']/i);
  assert.match(source, /export\s*\{[^}]*default/i);
});
