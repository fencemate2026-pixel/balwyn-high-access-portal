// Staff account screens, password setup page and Bright Glass blocks (25 Sep 2026).
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });

test("staff accounts open for administrators without the settings password, and never show a dead control", async () => {
  const { default: Manager } = await vite.ssrLoadModule("/app/portal-accounts-manager.tsx");
  const html = renderToStaticMarkup(React.createElement(Manager));
  assert.doesNotMatch(html, /Unlock administrator settings/);
  assert.match(html, /Create account/);
  assert.match(html, /View only \(password\)/);
  assert.match(html, /Operator \(password \+ authenticator\)/);
  assert.match(html, /Loading accounts/);
});

test("the sign-in badge keeps the Magic Keys logo and has no school line under it", async () => {
  const { default: DemoLogin } = await vite.ssrLoadModule("/app/demo-login.tsx");
  const html = renderToStaticMarkup(React.createElement(DemoLogin));
  const badge = html.slice(html.indexOf("login-school-badge"), html.indexOf("access-login-card"));
  assert.match(badge, /magic-brand-logo/);
  assert.match(html, /magic-keys-logo-2026\.webp/);
  assert.doesNotMatch(html, /magic-keys-school-logo/);
  assert.doesNotMatch(html, /src="\/magic-keys-logo\.png"/);
  assert.doesNotMatch(badge, /BALWYN HIGH SCHOOL/);
  assert.doesNotMatch(html, /balwyn-crest/);
  assert.doesNotMatch(html, /CAMPUS ACCESS PORTAL/);
  assert.doesNotMatch(html, /Balwyn High/);
  assert.doesNotMatch(html, /Your school/);
  assert.doesNotMatch(html, /safer schools/);
  assert.doesNotMatch(html, /campus controls/);
  assert.match(html, /SECURE ACCESS/);
  assert.match(html, /Sign in to your Magic Keys workspace/);
});

test("setup page never renders the one-time token on the server", async () => {
  const { default: Form } = await vite.ssrLoadModule("/app/setup/setup-password-form.tsx");
  const html = renderToStaticMarkup(React.createElement(Form));
  assert.doesNotMatch(html, /token=/);
  assert.match(html, /SECURE ACCESS/);
  assert.doesNotMatch(html, /BALWYN HIGH SCHOOL/);
  assert.doesNotMatch(html, /CAMPUS ACCESS PORTAL/);
});

test("glass gauge shows real values and a dash when there is no reading", async () => {
  const { GlassGauge } = await vite.ssrLoadModule("/app/glass-ui.tsx");
  const reading = renderToStaticMarkup(React.createElement(GlassGauge, { label: "Humidity", value: 62.4 }));
  assert.match(reading, /aria-valuenow="62"/);
  assert.match(reading, />62%</);
  assert.match(reading, /text-\[#FF7A00\]/);
  const empty = renderToStaticMarkup(React.createElement(GlassGauge, { label: "Rain chance today", value: null }));
  assert.match(empty, /aria-valuetext="No data"/);
  assert.match(empty, />—</);
  assert.doesNotMatch(empty, /stroke-dashoffset/);
});
