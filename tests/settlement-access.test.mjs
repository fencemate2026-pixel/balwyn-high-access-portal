// 337–339 Settlement Road: one site, two gates, two logins. Those logins see only this site.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const authLib = await vite.ssrLoadModule("/lib/portal-auth.ts");
const access = await vite.ssrLoadModule("/lib/settlement-access.ts");
const site = await vite.ssrLoadModule("/lib/settlement-site.ts");
const gddb = await vite.ssrLoadModule("/lib/gd-db.ts");
const swingRoute = await vite.ssrLoadModule("/app/api/owner/thomastown-swing/route.ts");
const settlementRoute = await vite.ssrLoadModule("/app/api/owner/settlement-road-swing/route.ts");
const slidingRoute = await vite.ssrLoadModule("/app/api/owner/thomastown-sliding/route.ts");
const milduraRoute = await vite.ssrLoadModule("/app/api/owner/mildura/route.ts");
const sitesRoute = await vite.ssrLoadModule("/app/api/owner/sites/route.ts");
const portalRoute = await vite.ssrLoadModule("/app/api/portal/route.ts");
const accountsRoute = await vite.ssrLoadModule("/app/api/accounts/route.ts");
const SwingView = (await vite.ssrLoadModule("/app/thomastown-swing-view.tsx")).default;
const SettlementView = (await vite.ssrLoadModule("/app/settlement-site-view.tsx")).default;
const sitemap = (await vite.ssrLoadModule("/app/sitemap.ts")).default;

const origin = "https://magickeys-balwyn-portal.com";
const SQL = readFileSync(new URL("../deploy/azure/gd/001_thomastown_swing.sql", import.meta.url), "utf8");
const JOSHUA = "joshua.rapa@cva.melbourne";
const TRACEY = "tracey@aquabaci.com.au";
const KEY = "55555555-5555-4555-8555-555555555555";
const EMPTY = { device: null, users: [], access: [], changes: [], commands: [], online: false, serverTime: "2026-11-12T01:00:00.000Z" };

async function fixture(t, { joshuaRole = "viewer" } = {}) {
  const pg = await PGlite.create();
  t.after(() => { gddb.setGdRunnerForTests(null); return pg.close(); });
  await pg.exec(SQL);
  await pg.exec("INSERT INTO gd.devices(device_id, site_name) VALUES ('settlement-road-swing', 'Settlement Road Swing Gate'), ('thomastown-sliding', 'sliding')");
  gddb.setGdRunnerForTests(async (fn) => {
    await pg.query("BEGIN");
    try {
      const out = await fn({ query: async (text, values) => { const r = await pg.query(text, values ?? []); return { rows: r.rows, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) }; } });
      await pg.query("COMMIT"); return out;
    } catch (e) { await pg.query("ROLLBACK"); throw e; }
  });
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, {
    PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: `owner@example.test|administrator,staff@example.test|administrator,${JOSHUA}|${joshuaRole},${TRACEY}|viewer`,
    PORTAL_OWNER_EMAIL: "owner@example.test",
  });
  return pg;
}

async function cookie(email, role) {
  return (await authLib.createSessionCookie({ displayName: "Member", email, role })).split(";")[0];
}
const get = (route, path, jar) => route.GET(new Request(`${origin}${path}`, { headers: { Cookie: jar } }));
const post = (route, path, jar, body) => route.POST(new Request(`${origin}${path}`, {
  method: "POST",
  headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: jar },
  body: JSON.stringify(body),
}));

test("the two named people are members, and nearby addresses are not", () => {
  assert.equal(access.isSettlementMember(`  ${JOSHUA.toUpperCase()}  `), true);
  assert.equal(access.isSettlementMember(` ${TRACEY} `), true);
  for (const email of ["", "joshua.rapa@cva.melbourne.au", "tracey@aquabaci.com", "owner@example.test", "staff@example.test", "joshua.rapa@cva.melbourne " + "x"]) {
    assert.equal(access.isSettlementMember(email), false, email);
  }
});

test("the site is the plan number plus the swing list and the sliding gate", () => {
  assert.equal(site.SETTLEMENT_SITE_ID, "settlement-road");
  assert.equal(site.SETTLEMENT_SITE_TITLE, "337 - 339 SETTLEMENT ROAD, THOMASTOWN");
  assert.equal(site.SETTLEMENT_PLAN_NUMBER, "819859Q");
  assert.deepEqual(site.SETTLEMENT_GATES.map((gate) => gate.device), ["settlement-road-swing", "thomastown-sliding"]);
  assert.deepEqual(site.SETTLEMENT_GATES.map((gate) => gate.label), ["Swing gate", "Sliding gate"]);
  assert.equal(access.isSettlementDevice("settlement-road-swing"), true);
  assert.equal(access.isSettlementDevice("thomastown-sliding"), true);
  assert.equal(access.isSettlementDevice("thomastown-swing"), false);
});

test("a member can read both gates on this site and cannot read Macquarie, Mildura, or the owner site list", async (t) => {
  await fixture(t);
  const jar = await cookie(` ${JOSHUA.toUpperCase()} `, "viewer");
  const swing = await get(settlementRoute, "/api/owner/settlement-road-swing", jar);
  assert.equal(swing.status, 200);
  assert.equal((await swing.json()).device.device_id, "settlement-road-swing");
  const sliding = await get(slidingRoute, "/api/owner/thomastown-sliding", await cookie(TRACEY, "viewer"));
  assert.equal(sliding.status, 200);
  assert.deepEqual((await sliding.json()).users, []);
  assert.equal((await get(swingRoute, "/api/owner/thomastown-swing", jar)).status, 404);
  assert.equal((await get(milduraRoute, "/api/owner/mildura", jar)).status, 404);
  assert.equal((await get(sitesRoute, "/api/owner/sites", jar)).status, 404);
  assert.equal((await accountsRoute.GET(new Request(`${origin}/api/accounts`, { headers: { Cookie: jar } }))).status, 403);
});

test("an administrator role on a member email still cannot open Macquarie or the operations snapshot", async (t) => {
  await fixture(t, { joshuaRole: "administrator" });
  const jar = await cookie(JOSHUA, "administrator");
  const user = await authLib.getSessionUser(new Request(`${origin}/api/portal`, { headers: { Cookie: jar } }));
  assert.notEqual(user.isOwner, true);
  assert.equal((await get(swingRoute, "/api/owner/thomastown-swing", jar)).status, 404);
  assert.equal((await get(settlementRoute, "/api/owner/settlement-road-swing", jar)).status, 200);
  const portal = await portalRoute.GET(new Request(`${origin}/api/portal`, { headers: { Cookie: jar } }));
  assert.equal(portal.status, 403);
  const body = await portal.json();
  assert.equal(body.code, "settlement_site");
  assert.equal("snapshot" in body, false);
});

test("a member can queue a caller on this site and cannot queue an open pulse", async (t) => {
  const pg = await fixture(t);
  const jar = await cookie(TRACEY, "viewer");
  const pulse = await post(settlementRoute, "/api/owner/settlement-road-swing", jar, { kind: "gate.pulse", clientKey: KEY });
  assert.equal(pulse.status, 404);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM gd.commands")).rows[0].n, 0);
  const added = await post(slidingRoute, "/api/owner/thomastown-sliding", jar, { kind: "user.add", name: "Pat Example", phone: "0499000111", clientKey: KEY });
  assert.equal(added.status, 200, JSON.stringify(await added.clone().json()));
  const row = (await pg.query("SELECT device_id, kind, actor_email FROM gd.commands")).rows[0];
  assert.equal(row.device_id, "thomastown-sliding");
  assert.equal(row.kind, "user.add");
  assert.equal(row.actor_email, TRACEY);
  assert.equal((await post(swingRoute, "/api/owner/thomastown-swing", jar, { kind: "gate.pulse", clientKey: KEY })).status, 404);
});

test("a staff administrator cannot open either gate on this site", async (t) => {
  await fixture(t);
  const jar = await cookie("staff@example.test", "administrator");
  assert.equal((await get(settlementRoute, "/api/owner/settlement-road-swing", jar)).status, 404);
  assert.equal((await get(slidingRoute, "/api/owner/thomastown-sliding", jar)).status, 404);
  assert.equal((await post(settlementRoute, "/api/owner/settlement-road-swing", jar, { kind: "user.add", name: "Pat", phone: "0499000111", clientKey: KEY })).status, 404);
});

test("the owner can still open Macquarie Drive", async (t) => {
  await fixture(t);
  const jar = await cookie("owner@example.test", "administrator");
  assert.equal((await get(swingRoute, "/api/owner/thomastown-swing", jar)).status, 200);
  assert.equal((await get(settlementRoute, "/api/owner/settlement-road-swing", jar)).status, 200);
});

test("each gate shows its own label and an empty dial-in slot, and only Macquarie shows Open", () => {
  const grouped = renderToStaticMarkup(React.createElement(SettlementView));
  assert.match(grouped, /337 - 339 SETTLEMENT ROAD, THOMASTOWN/);
  assert.match(grouped, /819859Q/);
  assert.match(grouped, /Swing gate/);
  assert.match(grouped, /Sliding gate/);
  for (const [device, title] of [["settlement-road-swing", "Swing gate"], ["thomastown-sliding", "Sliding gate"]]) {
    const html = renderToStaticMarkup(React.createElement(SwingView, { device, title, fixture: EMPTY, clientHref: null }));
    assert.match(html, new RegExp(title));
    assert.match(html, /Dial-in number not entered yet/);
    assert.equal(html.includes("> Open</button>"), false);
    assert.equal(html.includes('href="/macquarie"'), false);
    assert.match(html, />OPEN<\/span>/);
    assert.match(html, />CLOSE<\/span>/);
    assert.match(html, /They do not pulse the unit/);
    assert.doesNotMatch(html, /queues one pulse/);
    assert.match(html, device === "thomastown-sliding" ? /src="\/gates\/sliding-blue\.svg"/ : /src="\/gates\/single-swing-blue\.webp"/);
  }
  const macquarie = renderToStaticMarkup(React.createElement(SwingView, { device: "thomastown-swing", fixture: EMPTY }));
  assert.match(macquarie, /Macquarie Drive Thomastown/);
  assert.match(macquarie, /Dial-in number /);
  assert.equal(macquarie.includes("Dial-in number not entered yet"), false);
  assert.match(macquarie, /> Open<\/button>/);
  assert.match(macquarie, /href="\/macquarie"/);
  assert.match(macquarie, /src="\/gates\/single-swing-blue\.webp"/);
  assert.match(macquarie, /The Open button queues one pulse on the live unit/);
  assert.match(macquarie, />OPEN<\/span>/);
});

test("the public sitemap does not list this site", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.deepEqual(urls, [
    "https://magickeys-balwyn-portal.com",
    "https://magickeys-balwyn-portal.com/privacy",
    "https://magickeys-balwyn-portal.com/terms",
  ]);
});
