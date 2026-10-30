// Health endpoints (30 Oct 2026 outage and audit M1/L3).
// /api/health: shallow, reports the running commit so a deploy can prove the new
// version answers. /api/health/deep: proves the database answers, cached briefly.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { databaseFixture } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");

function withVersion(t, value) {
  const saved = process.env.APP_VERSION;
  t.after(() => { if (saved === undefined) delete process.env.APP_VERSION; else process.env.APP_VERSION = saved; });
  if (value === undefined) delete process.env.APP_VERSION; else process.env.APP_VERSION = value;
}

test("shallow health reports the running commit and nothing about hosting", async (t) => {
  const health = await vite.ssrLoadModule("/app/api/health/route.ts");
  withVersion(t, "62F85E1470802E5D1CF5319014CF954BCB2F1E6D");
  const body = await health.GET().json();
  assert.deepEqual(body, { status: "ok", version: "62f85e1470802e5d1cf5319014cf954bcb2f1e6d" });
  assert.equal("clientAddressSource" in body, false);
});

test("shallow health says unknown for a missing or malformed version", async (t) => {
  const health = await vite.ssrLoadModule("/app/api/health/route.ts");
  for (const value of [undefined, "", "not-a-sha", "<script>"]) {
    withVersion(t, value);
    assert.equal((await health.GET().json()).version, "unknown", String(value));
  }
});

test("deep health is 200 when the database answers and 503 when it does not", async (t) => {
  const { fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  env.fetchDatabase = fetchDatabase;
  // A fresh module instance per test: the 15-second cache lives at module level.
  const deep = await vite.ssrLoadModule(`/app/api/health/deep/route.ts?ok=${Date.now()}`);
  const ok = await deep.GET();
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.status, "ok");
  assert.equal(typeof okBody.databaseMs, "number");

  env.fetchDatabase = async () => { throw new Error("database down"); };
  const down = await vite.ssrLoadModule(`/app/api/health/deep/route.ts?down=${Date.now()}`);
  const failed = await down.GET();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).status, "database_unavailable");
});
