// Mildura read-only view (4 Nov 2026): owner-only, server-side reads of gd_mirror_*,
// reads only, never a PIN, and the pure shaping used by the charts and tiles.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const route = await vite.ssrLoadModule("/app/api/owner/sites/route.ts");
const vm = await vite.ssrLoadModule("/lib/mildura-view-model.ts");
const origin = "https://magickeys-balwyn-portal.com";
const SITE = { id: "55555555-5555-4555-8555-555555555555", slug: "mildura", name: "Mildura Working Men's Club", config_version: 1 };

function fake() {
  const calls = [];
  env.fetchDatabase = async (path, init = {}) => {
    const u = new URL(String(path), "https://example.supabase.co");
    calls.push({ method: init.method ?? "GET", path: u.pathname, search: decodeURIComponent(u.search) });
    const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname.endsWith("/gd_sites")) return json([SITE]);
    if (u.pathname.endsWith("/gd_mirror_users")) return json([{ local_id: 1, name: "A", enabled: true, schedule_type: "always" }]);
    return json([]);
  };
  return calls;
}
async function as(email, role = "administrator") {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: "owner@example.test|administrator,staff@example.test|administrator", PORTAL_OWNER_EMAIL: "owner@example.test" });
  const calls = fake();
  const cookie = (await auth.createSessionCookie({ displayName: "J", email, role })).split(";")[0];
  return { calls, get: (q) => route.GET(new Request(`${origin}/api/owner/sites${q}`, { headers: { Cookie: cookie } })) };
}

test("non-owners get 404 and no database call for the Mildura mirror", async () => {
  const { get, calls } = await as("staff@example.test");
  assert.equal((await get("?site=mildura&view=mirror")).status, 404);
  assert.equal(calls.length, 0);
});

test("owner reads every mirror table, scoped to the site, read-only, never a PIN", async () => {
  const { get, calls } = await as("owner@example.test");
  const res = await get("?site=mildura&view=mirror");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.users.length, 1);
  for (const t of ["gd_units", "gd_mirror_users", "gd_mirror_schedules", "gd_mirror_persons", "gd_mirror_access", "gd_mirror_changes"])
    assert.ok(calls.some((c) => c.path.endsWith(`/${t}`) && c.search.includes(`site_id=eq.${SITE.id}`)), t);
  assert.ok(calls.every((c) => c.method === "GET"), "reads only");
  assert.ok(calls.every((c) => !/pin/i.test(c.search)), "no PIN column is ever selected");
  assert.ok(!/secret_hash/.test(JSON.stringify(calls.filter((c) => c.path.endsWith("/gd_units")))), "unit key hash not selected");
});

test("breakdown, 30-day usage and health tiles", () => {
  const rows = [{ method: "keypad", success: true, occurred_at_local: "2026-11-03 10:00:00" }, { method: "keypad", success: false, occurred_at_local: "2026-11-03 11:00:00" },
    { method: "auto_open", success: true, occurred_at_local: "2026-11-02 09:00:00" }, { method: "keypad", success: true, occurred_at_local: "2026-09-01 09:00:00" }];
  assert.deepEqual(vm.accessBreakdown(rows), { granted: 2, denied: 1, autoOpen: 1 });
  const days = vm.usageByDay(rows, "2026-11-03");
  assert.equal(days.length, 30); assert.equal(days.at(-1).count, 2); assert.equal(days.at(-2).count, 0, "auto-open is not keypad usage");
  assert.ok(vm.healthTiles(null).every((t) => t.value === null), "not reported");
  const t = vm.healthTiles({ health: { board_temp_c: 48.25, cpu_percent: 7, uptime_s: 90000 } });
  assert.equal(t[0].value, "48.3 °C"); assert.equal(t[1].value, "7%"); assert.equal(t[4].value, "1 d 1 h"); assert.equal(t[2].value, null);
  assert.equal(vm.gateStatus({ lockdown: true }).label, "Lockdown");
  assert.equal(vm.gateStatus(null).label, "Not reported");
});

test("Phase 2: only the owner command route is written to, gate actuation stays disabled, no PIN shown, preview is dev-flag only", () => {
  const src = readFileSync(new URL("../app/mildura-site-view.tsx", import.meta.url), "utf8");
  const ctl = readFileSync(new URL("../app/mildura-controls.tsx", import.meta.url), "utf8");
  assert.ok(!/method:\s*"POST"/.test(src), "the view itself never writes; all writes go through mildura-controls");
  assert.deepEqual([...ctl.matchAll(/fetch\("([^"]+)"/g)].map((m) => m[1]).sort(), ["/api/owner/mildura", "/api/owner/mildura"], "controls only talk to the owner command route");
  assert.match(ctl, /\["Open Gate", "Hold Open", "Lockdown"\]\.map\([^)]*\) => <button[^>]*disabled /, "gate actuation stays disabled");
  assert.ok(!/u\.pin|p\.pin|\.pin\b/.test(src), "no stored PIN is ever rendered");
  assert.match(ctl, /type="password"[^>]*autoComplete="off"/, "PIN inputs are masked");
  assert.match(ctl, /setPin\(""\); setPin2\(""\);/, "PIN cleared after send");
  for (const t of ["Delete \\${u.name}\\?", "Disable ALL users\\?", "Enable ALL users\\?", "Delete \\${p.name}\\?"]) assert.match(src, new RegExp(t), `confirmation: ${t}`);
  assert.match(src, /Waiting for first sync from the Mildura Pi/);
  assert.match(readFileSync(new URL("../app/dev-preview/mildura/page.tsx", import.meta.url), "utf8"), /PORTAL_DEV_FIXTURES !== "1"\) notFound\(\)/);
});
