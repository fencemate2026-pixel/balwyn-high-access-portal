// Two portals from one codebase (8 Nov 2026, Jarrod):
//  - CLIENT portal: every school login, whatever its role. Everyday gate work only. No system settings,
//    automation, staff-account management, controller credentials, equipment mapping or other RJL sites.
//  - OWNER portal: only a verified administrator session whose email equals PORTAL_OWNER_EMAIL.
// Ownership is decided on the server (lib/owner-access.ts); these tests prove the server refuses a client
// login on every settings-class route and that the rendered client view does not offer those screens.
import { serverFixturePlugin } from "./server-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { databaseFixture, passwordHash } from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [serverFixturePlugin] });
after(() => vite.close());
const { env } = await vite.ssrLoadModule("cloudflare:workers");
const auth = await vite.ssrLoadModule("/lib/portal-auth.ts");
const protectedSettings = await vite.ssrLoadModule("/lib/protected-settings.ts");
const adminRoute = await vite.ssrLoadModule("/app/api/auth/admin/route.ts");
const portal = await vite.ssrLoadModule("/app/api/portal/route.ts");
const accountsRoute = await vite.ssrLoadModule("/app/api/accounts/route.ts");
const activityRoute = await vite.ssrLoadModule("/app/api/accounts/activity/route.ts");
const equipmentRoute = await vite.ssrLoadModule("/app/api/equipment/route.ts");
const profileRoute = await vite.ssrLoadModule("/app/api/profile/route.ts");

const origin = "https://magickeys-balwyn-portal.com";
const password = "A-test-password-934!";
const hash = await passwordHash(password, "test-password-salt");
const OWNER = "owner@example.test";
const SCHOOL_ADMIN = "school-admin@example.test";
const OPERATOR = "operator@example.test";
const VIEWER = "viewer@example.test";

function req(path, body, cookie = "") {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function world(t) {
  const { pg, fetchDatabase } = await databaseFixture(t);
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, {
    PORTAL_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_ALLOWED_EMAILS: `${OWNER}|administrator,${SCHOOL_ADMIN}|administrator,${OPERATOR}|operator,${VIEWER}|viewer`,
    PORTAL_OWNER_EMAIL: OWNER,
    PORTAL_USERNAME: "Owner", PORTAL_OPERATOR_EMAIL: OWNER, PORTAL_PASSWORD_SALT: "test-password-salt", PORTAL_PASSWORD_HASH: hash,
    fetchDatabase,
  });
  const cookieFor = async (email, role) => (await auth.createSessionCookie({ displayName: email.split("@")[0], email, role })).split(";")[0];
  return {
    pg,
    owner: await cookieFor(OWNER, "administrator"),
    schoolAdmin: await cookieFor(SCHOOL_ADMIN, "administrator"),
    operator: await cookieFor(OPERATOR, "operator"),
    viewer: await cookieFor(VIEWER, "viewer"),
    cookieFor,
  };
}

async function unlockAsOwner(cookie) {
  const response = await adminRoute.POST(req("/api/auth/admin", { password }, cookie));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return `${cookie}; ${response.headers.getSetCookie()[0].split(";")[0]}`;
}

const SETTINGS_ACTIONS = [...protectedSettings.PROTECTED_SETTINGS_ACTIONS];

test("the settings-class action list is the set the server gates (guards against a new action slipping past)", () => {
  assert.deepEqual(SETTINGS_ACTIONS.sort(), [
    "add_automation", "delete_automation", "provision_controller", "record_service",
    "reset_auth_lockouts", "toggle_automation", "update_settings",
  ]);
});

test("only the owner is the owner: client logins of every role carry no owner flag", async (t) => {
  const w = await world(t);
  assert.equal((await auth.getSessionUser(req("/api/portal", undefined, w.owner))).isOwner, true);
  for (const cookie of [w.schoolAdmin, w.operator, w.viewer]) {
    assert.notEqual((await auth.getSessionUser(req("/api/portal", undefined, cookie))).isOwner, true);
  }
});

test("the owner's email on a non-administrator role is not the owner", async (t) => {
  const w = await world(t);
  env.GOOGLE_ALLOWED_EMAILS = `${OWNER}|operator`;
  const cookie = await w.cookieFor(OWNER, "operator");
  assert.notEqual((await auth.getSessionUser(req("/api/portal", undefined, cookie))).isOwner, true);
  assert.equal((await accountsRoute.GET(req("/api/accounts", undefined, cookie))).status, 403);
});

test("with PORTAL_OWNER_EMAIL unset nobody is the owner (fails closed)", async (t) => {
  const w = await world(t);
  delete env.PORTAL_OWNER_EMAIL;
  assert.notEqual((await auth.getSessionUser(req("/api/portal", undefined, w.owner))).isOwner, true);
  assert.equal((await accountsRoute.GET(req("/api/accounts", undefined, w.owner))).status, 403);
});

test("client logins are refused every settings-class action with owner_required, before any password prompt", async (t) => {
  const w = await world(t);
  for (const [who, cookie] of [["school administrator", w.schoolAdmin], ["operator", w.operator]]) {
    for (const action of SETTINGS_ACTIONS) {
      const response = await portal.POST(req("/api/portal", { action }, cookie));
      assert.equal(response.status, 403, `${who} ${action}`);
      assert.equal((await response.json()).code, "owner_required", `${who} ${action}`);
    }
  }
});

test("a client administrator cannot obtain the settings unlock, even with the correct password", async (t) => {
  const w = await world(t);
  const response = await adminRoute.POST(req("/api/auth/admin", { password }, w.schoolAdmin));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "owner_required");
  assert.equal(response.headers.getSetCookie().length, 0, "no unlock cookie is issued");
  assert.equal((await adminRoute.GET(req("/api/auth/admin", undefined, w.schoolAdmin))).status, 403);
  await assert.rejects(auth.createAdminSettingsCookie(req("/api/auth/admin", undefined, w.schoolAdmin)), /Owner sign-in required/);
});

test("an unlock cookie cannot be carried across to a client session", async (t) => {
  const w = await world(t);
  const unlockCookie = (await unlockAsOwner(w.owner)).split("; ").pop();
  // The owner's unlock cookie is bound to the owner's session cookie; presented with a client session it is worthless.
  assert.equal(await auth.getAdminSettingsAccess(req("/api/auth/admin", undefined, `${w.schoolAdmin}; ${unlockCookie}`)), null);
  const response = await portal.POST(req("/api/portal", { action: "update_settings", patch: { faultAlerts: false } }, `${w.schoolAdmin}; ${unlockCookie}`));
  assert.equal(response.status, 403);
});

test("client logins cannot list, create or change staff accounts, or read one person's activity", async (t) => {
  const w = await world(t);
  for (const cookie of [w.schoolAdmin, w.operator, w.viewer]) {
    assert.equal((await accountsRoute.GET(req("/api/accounts", undefined, cookie))).status, 403);
    assert.equal((await accountsRoute.POST(req("/api/accounts", { action: "create", email: "new@example.test", displayName: "New Person", role: "viewer" }, cookie))).status, 403);
    assert.equal((await activityRoute.GET(req("/api/accounts/activity?id=1", undefined, cookie))).status, 403);
  }
  const schoolAdminDenied = await accountsRoute.GET(req("/api/accounts", undefined, w.schoolAdmin));
  assert.equal((await schoolAdminDenied.json()).code, "owner_required");
  const { rows } = await w.pg.query("SELECT count(*)::int AS n FROM portal_accounts");
  assert.equal(rows[0].n, 0, "no account was created");
});

test("a client administrator cannot read or save equipment mapping, or see other users' profiles", async (t) => {
  const w = await world(t);
  const saved = await equipmentRoute.POST(req("/api/equipment", { refreshSeconds: 5 }, w.schoolAdmin));
  assert.equal(saved.status, 403);
  assert.equal((await saved.json()).code, "owner_required");
  const read = await (await equipmentRoute.GET(req("/api/equipment", undefined, w.schoolAdmin))).json();
  assert.ok(read.preferences && !read.config && !read.connection, "only display preferences are returned to a client");
  assert.equal((await profileRoute.GET(req("/api/profile?scope=all", undefined, w.schoolAdmin))).status, 403);
});

test("the client portal still does its everyday work: snapshot, schedules and emergency authority are unchanged", async (t) => {
  const w = await world(t);
  assert.equal((await portal.GET(req("/api/portal", undefined, w.viewer))).status, 200);
  assert.equal((await portal.GET(req("/api/portal", undefined, w.schoolAdmin))).status, 200);
  const week = Object.fromEntries(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => [day, { enabled: true, open: "06:00", close: "18:00" }]));
  const saved = await portal.POST(req("/api/portal", { action: "save_schedule", gateId: "TF-ENTRY", week }, w.schoolAdmin));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  assert.equal((await w.pg.query("SELECT open_time FROM gate_schedules WHERE gate_id = 'TF-ENTRY' AND day = 'Monday'")).rows[0].open_time, "06:00");
  // Operators still cannot change schedules (role rule from before this change is intact).
  assert.equal((await portal.POST(req("/api/portal", { action: "save_schedule", gateId: "TF-ENTRY", week }, w.operator))).status, 403);
});

test("the owner portal keeps everything: password unlock, settings, accounts, equipment, other users' profiles", async (t) => {
  const w = await world(t);
  // Without the unlock the owner is still asked for the settings password.
  const locked = await portal.POST(req("/api/portal", { action: "update_settings", patch: { faultAlerts: false } }, w.owner));
  assert.equal(locked.status, 403);
  assert.equal((await locked.json()).code, "admin_password_required");
  const unlocked = await unlockAsOwner(w.owner);
  const changed = await portal.POST(req("/api/portal", { action: "update_settings", patch: { faultAlerts: false } }, unlocked));
  assert.equal(changed.status, 200, JSON.stringify(await changed.clone().json()));
  assert.equal((await accountsRoute.GET(req("/api/accounts", undefined, unlocked))).status, 200);
  assert.equal((await equipmentRoute.GET(req("/api/equipment", undefined, unlocked))).status, 200);
  assert.ok((await (await equipmentRoute.GET(req("/api/equipment", undefined, unlocked))).json()).config, "owner receives the full equipment config");
  assert.equal((await profileRoute.GET(req("/api/profile?scope=all", undefined, unlocked))).status, 200);
});

// ---- Rendered views: what each login is actually shown --------------------------------------------------------

async function renderFor(w, cookie) {
  const user = await auth.getSessionUser(req("/api/portal", undefined, cookie));
  const snapshot = (await (await portal.GET(req("/api/portal", undefined, cookie))).json()).snapshot;
  const { default: DashboardClient } = await vite.ssrLoadModule("/app/dashboard-client.tsx");
  return renderToStaticMarkup(React.createElement(DashboardClient, { user, initialData: snapshot }));
}
const navLabels = (html) => new Set([...html.matchAll(/portal-nav-button[^>]*>.*?<span>([^<]+)<\/span>/g)].map((m) => m[1].replace(/&amp;/g, "&")));

test("rendered CLIENT portal: no settings, automation, RJL portals or Thomastown; has the everyday screens", async (t) => {
  const w = await world(t);
  for (const cookie of [w.schoolAdmin, w.operator, w.viewer]) {
    const html = await renderFor(w, cookie);
    const labels = navLabels(html);
    for (const owned of ["System settings", "Automation", "Access & users", "Operations portal", "Thomastown", "Mildura"]) assert.ok(!labels.has(owned), `client sees nav "${owned}"`);
    assert.ok(!html.includes("Balwyn High"), "client view has no Balwyn High name");
    assert.ok(!html.includes("balwyn-high-school-logo"), "client view has no school logo");
    assert.ok(!html.includes("balwyn-crest"), "client view has no school crest");
    assert.ok(!html.includes("RJL portals"), "no RJL portals group");
    assert.ok(!/Thomastown|Mildura/.test(html), "no other site is named anywhere in the client view");
    for (const everyday of ["Campus overview", "Gate schedules", "Stadium hire", "Activity log", "My account"]) assert.ok(labels.has(everyday), `client has nav "${everyday}"`);
  }
});

test("rendered OWNER portal: the full set, including settings, automation and the RJL portals group", async (t) => {
  const w = await world(t);
  const html = await renderFor(w, w.owner);
  const labels = navLabels(html);
  for (const owned of ["System settings", "Automation", "Access & users", "Campus overview", "Gate schedules"]) assert.ok(labels.has(owned), `owner has nav "${owned}"`);
  assert.ok(html.includes("RJL portals"), "owner sees the RJL portals group");
  assert.ok(labels.has("Operations portal"), "owner can open this portal without the school name");
  assert.ok(!html.includes("Balwyn High"), "owner view has no Balwyn High name");
  assert.ok(!html.includes("balwyn-high-school-logo"), "owner view has no school logo");
  assert.ok(!labels.has("My account"), "owner keeps the full Access & users page");
});
