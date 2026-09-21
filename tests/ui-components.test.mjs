import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, ".next", "static"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test("renders the public landing page with operational overview content", async () => {
  const { default: PublicAppHome } = await vite.ssrLoadModule("/app/public-app-home.tsx");
  const html = renderToStaticMarkup(React.createElement(PublicAppHome));

  assert.match(html, /Professional access operations for gates, schedules and controller health/);
  assert.match(html, /Live operational context/);
  assert.match(html, /Verified sign-in/);
  assert.match(html, /Operator sign in/);
});

test("renders dashboard gate cards with portal sync and heartbeat context", async () => {
  const { default: DashboardClient } = await vite.ssrLoadModule("/app/dashboard-client.tsx");
  const { ACTIVE_GATES, makeSchedules } = await vite.ssrLoadModule("/lib/portal-model.ts");
  const now = new Date().toISOString();
  const snapshot = {
    systemMode: "normal",
    gates: ACTIVE_GATES.map((gate, index) => ({
      gateId: gate.id,
      commandedPosition: gate.defaultPosition,
      reportedPosition: index === 0 ? "open" : "closed",
      controllerState: "online",
      safetyOk: true,
      lastSeen: now,
      lastCommandState: "acknowledged",
      lastCommandId: index + 1,
      lastError: null,
      credentialIssued: true,
      commissioned: true,
    })),
    schedules: makeSchedules(),
    activity: [],
    automations: [],
    settings: { positionMonitoring: true, faultAlerts: true, voiceAnnouncements: false, enabledModules: ["mobile"] },
    plan: { tier: "core", name: "Gate Operations", advancedFeatures: false },
    user: { displayName: "Test Operator", email: "operator@example.test", role: "administrator" },
    serverTime: now,
  };
  const html = renderToStaticMarkup(React.createElement(DashboardClient, { user: snapshot.user, initialData: snapshot }));

  assert.match(html, /Portal sync/);
  assert.match(html, /Timezone · Australia\/Melbourne/);
  assert.match(html, /Heartbeat just now/);
  assert.match(html, /Safety healthy/);
  assert.match(html, /Heartbeat coverage · 2\/2 active controllers/);
  assert.match(html, /class=\"tile gate-tile access-icon gate-state-run is-open single-swing\"/);
  assert.match(html, /class=\"tile gate-tile access-icon gate-state-stop is-closed single-swing\"/);
  assert.doesNotMatch(html, /single-gate-image|double-gate-image/);
});

test("keeps the inline gate-tile stage block-sized for the live dashboard cards", async () => {
  const css = await readFile(path.join(root, "app", "gate-preview.css"), "utf8");

  assert.match(css, /\.gate-tile\{[\s\S]*display:block !important;/);
  assert.match(css, /\.gate-tile \.stage\{[\s\S]*display:block !important;/);
});

test("renders gate tile states with accessible labels", async () => {
  const { default: GateTile } = await vite.ssrLoadModule("/app/gate-tile.tsx");
  const gate = {
    id: "OFFICE-ENTRY-BOOM1",
    name: "Office Entry 1 Boom Gate",
    area: "Office",
    type: "Boom gate",
    kind: "boom",
    active: true,
    group: "front",
    defaultPosition: "closed",
  };

  const open = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "open" }));
  assert.match(open, /gate-state-run/);
  assert.match(open, /aria-label="Office Entry 1 Boom Gate: Operating, Confirmed open"/);

  const closed = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "closed" }));
  assert.match(closed, /gate-state-stop/);
  assert.match(closed, /aria-label="Office Entry 1 Boom Gate: Stop, Confirmed closed"/);

  const moving = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "moving" }));
  assert.match(moving, /gate-state-run/);
  assert.match(moving, /is-moving/);
  assert.match(moving, /aria-label="Office Entry 1 Boom Gate: Operating, Moving, keep clear"/);

  const issue = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "unknown" }));
  assert.match(issue, /gate-state-issue/);
  assert.match(issue, /aria-label="Office Entry 1 Boom Gate: Issue, Status unknown"/);

  const custom = renderToStaticMarkup(React.createElement(GateTile, {
    gate,
    position: "closed",
    ariaLabel: "Custom office gate label",
  }));
  assert.match(custom, /aria-label="Custom office gate label"/);
});
