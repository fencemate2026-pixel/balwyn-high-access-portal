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

test("accounts manager stays locked until the administrator unlock, and never shows a dead control", async () => {
  const { default: Manager } = await vite.ssrLoadModule("/app/portal-accounts-manager.tsx");
  const locked = renderToStaticMarkup(React.createElement(Manager, { adminUnlocked: false, onUnlock: () => {} }));
  assert.match(locked, /Unlock administrator settings to create or change staff accounts/);
  assert.doesNotMatch(locked, /Create account/);
  const unlocked = renderToStaticMarkup(React.createElement(Manager, { adminUnlocked: true, onUnlock: () => {} }));
  assert.match(unlocked, /Create account/);
  assert.match(unlocked, /View only \(password\)/);
  assert.match(unlocked, /Operator \(password \+ authenticator\)/);
  assert.match(unlocked, /Loading accounts/);
});

test("setup page never renders the one-time token on the server", async () => {
  const { default: Form } = await vite.ssrLoadModule("/app/setup/setup-password-form.tsx");
  const html = renderToStaticMarkup(React.createElement(Form));
  assert.doesNotMatch(html, /token=/);
  assert.match(html, /CAMPUS ACCESS PORTAL/);
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
