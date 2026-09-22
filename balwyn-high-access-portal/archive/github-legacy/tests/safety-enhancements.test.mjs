import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { getTableColumns } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

test("registers the perimeter force-gate in the shared gate config", async () => {
  const { gates, perimeterForceGateId } = await vite.ssrLoadModule("/lib/portal-config.ts");
  const perimeterGate = gates.find((gate) => gate.id === perimeterForceGateId);

  assert.ok(perimeterGate);
  assert.equal(perimeterGate.forceGate, true);
  assert.match(perimeterGate.type, /perimeter force-gate/i);
});

test("routes confirmed weapon detections through lockdown and perimeter deployment", async () => {
  const { createSyntheticDetectionEvent, processDetectionAlert } = await vite.ssrLoadModule(
    "/lib/detection-alerts.ts",
  );

  const event = createSyntheticDetectionEvent("firearm", "North Corridor");
  const result = processDetectionAlert({
    detectionEvent: event,
    decision: "confirmed",
    operator: "Paul Sutton",
  });

  assert.equal(result.nextMode, "lockdown");
  assert.equal(result.perimeterState, "deployed");
  assert.equal(result.perimeterPosition, "closed");
  assert.equal(result.reviewedEvent.status, "reviewed");
  assert.match(result.activity[1].action, /lockdown/i);
});

test("calculates advisory evacuation routes and caches by incident location", async () => {
  const { loadSentinelFloorPlan } = await vite.ssrLoadModule("/lib/sentinel-integration.ts");
  const { calculateEvacuationRoutes } = await vite.ssrLoadModule("/lib/evacuation-routes.ts");

  const floorPlan = loadSentinelFloorPlan();
  const first = calculateEvacuationRoutes(floorPlan, "Science Lab");
  const second = calculateEvacuationRoutes(floorPlan, "Science Lab");

  assert.equal(first, second);
  assert.equal(first.advisoryOnly, true);
  assert.equal(first.humanReviewed, false);
  assert.ok(first.routes.some((route) => route.status === "safe"));
  assert.ok(first.exits.some((exit) => exit.status === "blocked"));
});

test("renders the perimeter gate icon and reviewed-routing hold state", async () => {
  const { PerimeterGateIcon } = await vite.ssrLoadModule("/components/PerimeterGateIcon.tsx");
  const { EvacuationRoutingPanel } = await vite.ssrLoadModule(
    "/components/EvacuationRoutingPanel.tsx",
  );
  const { loadSentinelFloorPlan } = await vite.ssrLoadModule("/lib/sentinel-integration.ts");
  const { calculateEvacuationRoutes } = await vite.ssrLoadModule("/lib/evacuation-routes.ts");

  const iconHtml = renderToStaticMarkup(
    React.createElement(PerimeterGateIcon, {
      position: "closed",
      state: "deployed",
    }),
  );
  const routePlan = calculateEvacuationRoutes(loadSentinelFloorPlan(), "Library");
  const panelHtml = renderToStaticMarkup(
    React.createElement(EvacuationRoutingPanel, {
      floorPlanName: "sg-pro-sentinel synthetic lower-ground layout",
      incidentLocation: "Library",
      routePlan,
      isFireMode: true,
      onIncidentLocationChange: () => {},
      onReviewRoutes: () => {},
    }),
  );

  assert.match(iconHtml, /perimeter-force-gate/);
  assert.match(iconHtml, /state-deployed/);
  assert.match(panelHtml, /Routes pending human review/);
});

test("defines the D1 audit tables and critical verification columns", async () => {
  const schema = await import("../db/schema.ts");

  assert.ok(getTableColumns(schema.gatesConfig).forceGate);
  assert.ok(getTableColumns(schema.gateStates).perimeterState);
  assert.ok(getTableColumns(schema.detectionEvents).imageReference);
  assert.ok(getTableColumns(schema.alertVerifications).decision);
  assert.ok(getTableColumns(schema.systemEvents).mode);
});
