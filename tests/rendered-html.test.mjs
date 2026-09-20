import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Next server build includes authentication and controller routes", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.next/server/app-paths-manifest.json", import.meta.url), "utf8"));
  for (const route of ["/login/page", "/api/auth/email/route", "/api/portal/route", "/api/doors/open/route"]) assert.ok(manifest[route], route);
});
