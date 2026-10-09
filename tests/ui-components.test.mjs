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
  const now = new Date(Date.now() + 60_000).toISOString();
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
  assert.match(html, /Since last report/);
  assert.match(html, /Verified circuit/);
  assert.match(html, /Heartbeat coverage · 2\/2 active controllers/);
  // Site decision: fire evacuation is offered, lockdown is not.
  assert.match(html, /START FIRE \/ EVACUATION/);
  assert.doesNotMatch(html, /START LOCKDOWN/);
  // SSR retains approved fallback artwork; the 3D model is client-only and state driven.
  assert.match(html, /class=\"gate-tile gate-model access-icon gate-state-run is-open single-swing is-interactive\"/);
  assert.match(html, /class=\"gate-tile gate-model access-icon gate-state-stop is-closed single-swing is-interactive\"/);
  assert.match(html, /src=\"\/gates\/single-swing-blue.webp\"/);
  assert.doesNotMatch(html, /single-gate-image|double-gate-image/);
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
  assert.match(open, /<span class="gate-model-fallback"/);
  assert.match(open, /src="\/gates\/boom-blue.webp"/);
  assert.match(open, /gate-state-run/);
  assert.doesNotMatch(open, /lamp-stop|lamp-issue/);
  assert.match(open, /aria-label="Office Entry 1 Boom Gate: Operating, Confirmed open"/);

  const closed = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "closed" }));
  assert.match(closed, /gate-state-stop/);
  assert.match(closed, /gate-state-stop/);
  assert.match(closed, /aria-label="Office Entry 1 Boom Gate: Stop, Confirmed closed"/);

  const moving = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "moving" }));
  assert.match(moving, /gate-state-issue/);
  assert.match(moving, /is-moving/);
  assert.match(moving, /aria-label="Office Entry 1 Boom Gate: Operating, Moving, keep clear"/);

  const issue = renderToStaticMarkup(React.createElement(GateTile, { gate, position: "unknown" }));
  assert.match(issue, /gate-state-issue/);
  assert.match(issue, /gate-state-issue/);
  assert.doesNotMatch(issue, /lamp-run|lamp-stop/);
  assert.match(issue, /aria-label="Office Entry 1 Boom Gate: Issue, Status unknown"/);

  const custom = renderToStaticMarkup(React.createElement(GateTile, {
    gate,
    position: "closed",
    ariaLabel: "Custom office gate label",
  }));
  assert.match(custom, /aria-label="Custom office gate label"/);
});

// A realistic presentation must not turn stale or invalid sensor data green.
test("condition cards distinguish commissioning, faults and invalid heartbeats", async () => {
  const { controllerHealth } = await vite.ssrLoadModule("/app/gate-condition-panel.tsx");
  const now = Date.now();
  const online = { commissioned: true, controllerState: "online", safetyOk: true, lastSeen: new Date(now).toISOString(), lastCommandState: "idle" };
  assert.equal(controllerHealth(undefined, "unknown", now).tone, "amber");
  assert.equal(controllerHealth(online, "closed", now).tone, "green");
  assert.equal(controllerHealth({ ...online, lastSeen: "invalid" }, "closed", now).tone, "red");
  assert.equal(controllerHealth({ ...online, lastSeen: new Date(now - 91_000).toISOString() }, "closed", now).tone, "red");
  assert.equal(controllerHealth({ ...online, controllerState: "fault" }, "closed", now).tone, "red");
  assert.equal(controllerHealth({ ...online, safetyOk: null }, "closed", now).tone, "amber");
});

test("campus calendar keeps Monday boundaries across Melbourne daylight saving", async () => {
  const { campusDate, shiftDate, weekStart } = await vite.ssrLoadModule("/app/campus-calendar.tsx");
  assert.equal(campusDate(new Date("2026-10-03T16:30:00Z")), "2026-10-04");
  assert.equal(weekStart("2026-10-04"), "2026-09-28");
  assert.equal(shiftDate("2026-10-04", 1), "2026-10-05");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});

test("view-only staff see the fire control as locked, administrators see it live", async () => {
  const { default: DashboardClient } = await vite.ssrLoadModule("/app/dashboard-client.tsx");
  const { ACTIVE_GATES, makeSchedules } = await vite.ssrLoadModule("/lib/portal-model.ts");
  const now = new Date(Date.now() + 60_000).toISOString();
  const snapshotFor = (role, systemMode = "normal") => ({
    systemMode,
    gates: ACTIVE_GATES.map((gate) => ({
      gateId: gate.id, commandedPosition: gate.defaultPosition, reportedPosition: "closed", controllerState: "online",
      safetyOk: true, lastSeen: now, lastCommandState: "idle", lastCommandId: null, lastError: null, credentialIssued: true, commissioned: true,
    })),
    schedules: makeSchedules(), activity: [], automations: [],
    settings: { positionMonitoring: true, faultAlerts: true, voiceAnnouncements: false, enabledModules: ["mobile"] },
    plan: { tier: "core", name: "Gate Operations", advancedFeatures: false },
    user: { displayName: "Test User", email: "user@example.test", role },
    serverTime: now,
  });
  const render = (snapshot) => renderToStaticMarkup(React.createElement(DashboardClient, { user: snapshot.user, initialData: snapshot }));
  const fireButton = (html) => html.match(/<button[^>]*class="safety-command fire[^"]*"[^>]*>/)?.[0] ?? "";

  // Viewer, no emergency: disabled, marked locked, says administrator only.
  const viewer = render(snapshotFor("viewer"));
  assert.match(fireButton(viewer), /is-locked/);
  assert.match(fireButton(viewer), /disabled=""/);
  assert.match(viewer, /FIRE \/ EVACUATION · ADMIN ONLY/);
  assert.doesNotMatch(viewer, /START FIRE \/ EVACUATION/);

  // Operator (can open gates, cannot start an evacuation): also locked.
  assert.match(fireButton(render(snapshotFor("operator"))), /is-locked/);

  // Administrator: the live red button, not locked.
  const admin = render(snapshotFor("administrator"));
  assert.match(fireButton(admin), /safety-command fire/);
  assert.doesNotMatch(fireButton(admin), /is-locked|disabled/);
  assert.match(admin, /START FIRE \/ EVACUATION/);

  // During an evacuation everyone sees the red ACTIVE state, never the locked style.
  const viewerDuringFire = render(snapshotFor("viewer", "fire"));
  assert.match(fireButton(viewerDuringFire), /is-live/);
  assert.doesNotMatch(fireButton(viewerDuringFire), /is-locked/);
  assert.match(viewerDuringFire, /FIRE \/ EVACUATION · ACTIVE/);
});
