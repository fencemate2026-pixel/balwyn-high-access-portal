// Profile photos held in PostgreSQL (6 Nov 2026), for the portal's own database.
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
const { databaseProfileStorage } = await vite.ssrLoadModule("/lib/db-profile-storage.ts");

test("a photo can be stored, read back byte for byte, refused when duplicated, and deleted", async (t) => {
  const { fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  const store = databaseProfileStorage();
  const key = "profiles/abc-123/def-456";
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => i % 256);
  await store.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  const got = await store.get(key);
  assert.equal(got?.httpMetadata.contentType, "image/png");
  assert.deepEqual(Buffer.from(got.body), Buffer.from(bytes));
  await assert.rejects(store.put(key, bytes, { httpMetadata: { contentType: "image/png" } }), "existing key is not replaced");
  await store.delete(key);
  assert.equal(await store.get(key), null);
});

test("bad keys, types and oversize photos are refused", async (t) => {
  const { fetchDatabase } = await databaseFixture(t);
  env.fetchDatabase = fetchDatabase;
  const store = databaseProfileStorage();
  const ok = { httpMetadata: { contentType: "image/png" } };
  await assert.rejects(store.put("../etc/passwd", new Uint8Array(4), ok), /Invalid profile image key/);
  await assert.rejects(store.put("profiles/a/b", new Uint8Array(4), { httpMetadata: { contentType: "text/html" } }), /storage failed/);
  await assert.rejects(store.put("profiles/a/b", new Uint8Array(3 * 1024 * 1024 + 1), ok), /storage failed/);
  await assert.rejects(store.get("nope"), /Invalid profile image key/);
});
