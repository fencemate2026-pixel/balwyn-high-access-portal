import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

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

const emergency = await vite.ssrLoadModule("/lib/emergency-response-system.ts");

const baseDetection = {
  id: "threat-001",
  threatType: "armed_intruder",
  location: "OUTSIDE_PERIMETER",
  detectedZone: "NORTH_FENCE",
  thermal: { confidencePercent: 99, distanceMeters: 230, timestampMs: 0 },
  radar: { confidencePercent: 99, distanceMeters: 220, timestampMs: 1000 },
  video: { confidencePercent: 99, distanceMeters: 210, timestampMs: 2000 },
};

const historical = [
  {
    id: "inc-1",
    threatType: "armed_intruder",
    location: "OUTSIDE_PERIMETER",
    detectedZone: "NORTH_FENCE",
    destinationZone: "GYMNASIUM",
    strategy: "FULL_PERIMETER_LOCKDOWN",
    successful: true,
  },
  {
    id: "inc-2",
    threatType: "armed_intruder",
    location: "OUTSIDE_PERIMETER",
    detectedZone: "NORTH_FENCE",
    destinationZone: "GYMNASIUM",
    strategy: "FULL_PERIMETER_LOCKDOWN",
    successful: true,
  },
  {
    id: "inc-3",
    threatType: "armed_intruder",
    location: "OUTSIDE_PERIMETER",
    detectedZone: "WEST_FENCE",
    destinationZone: "OVAL",
    strategy: "FULL_PERIMETER_LOCKDOWN",
    successful: true,
  },
  {
    id: "inc-4",
    threatType: "trespasser",
    location: "INSIDE_BUILDING",
    detectedZone: "LIBRARY",
    destinationZone: "ADMIN",
    strategy: "INTELLIGENT_HERDING",
    successful: false,
  },
];

test("calculates sensor fusion, speed, and ETA", () => {
  const fusion = emergency.calculateSensorFusion(baseDetection);
  assert.equal(fusion.sensorFusionConfidence, 99);
  assert.equal(fusion.approachSpeedMps, 10);
  assert.equal(fusion.etaToPerimeterSeconds, 21);
});

test("finds and ranks similar incidents", () => {
  const similar = emergency.searchSimilarIncidents(baseDetection, historical);
  assert.equal(similar.length, 3);
  assert.equal(similar[0].id, "inc-1");
  assert.equal(similar[1].id, "inc-2");
});

test("predicts destination using historical incident patterns", () => {
  const similar = emergency.searchSimilarIncidents(baseDetection, historical);
  const destination = emergency.predictThreatMovement(baseDetection, similar);
  assert.equal(destination, "GYMNASIUM");
});

test("computes recommendation confidence with required formula", () => {
  const lowSignalDetection = {
    ...baseDetection,
    thermal: { ...baseDetection.thermal, confidencePercent: 96 },
    radar: { ...baseDetection.radar, confidencePercent: 95 },
    video: { ...baseDetection.video, confidencePercent: 94 },
  };
  const mixedHistory = [
    { ...historical[0], successful: true },
    { ...historical[1], successful: false },
  ];
  const result = emergency.analyzeThreat(lowSignalDetection, mixedHistory);
  assert.equal(result.sensorFusionConfidence, 95);
  assert.equal(result.historicalAccuracyPercent, 50);
  assert.equal(result.confidencePercent, 72.5);
});

test("does not produce recommendation below 98 percent confidence", () => {
  const lowSignalDetection = {
    ...baseDetection,
    thermal: { ...baseDetection.thermal, confidencePercent: 95 },
    radar: { ...baseDetection.radar, confidencePercent: 94 },
    video: { ...baseDetection.video, confidencePercent: 95 },
  };
  const unsuccessfulHistory = [
    { ...historical[0], successful: false },
    { ...historical[1], successful: false },
  ];
  const result = emergency.analyzeThreat(lowSignalDetection, unsuccessfulHistory);
  assert.equal(result.meetsThreshold, false);
  assert.equal(result.recommendation, null);
});

test("recommends full perimeter lockdown for high-confidence outside threats", () => {
  const highConfidenceHistory = historical.map((incident) => ({ ...incident, successful: true }));
  const result = emergency.analyzeThreat(baseDetection, highConfidenceHistory);

  assert.equal(result.meetsThreshold, true);
  assert.equal(result.recommendation.strategy, "FULL_PERIMETER_LOCKDOWN");
  assert.equal(result.recommendation.gatePlan.lockGateIds.length, 17);
  assert.equal(result.recommendation.broadcast.scope, "ALL_ROOMS");
  assert.equal(result.recommendation.broadcast.message, "EVACUATE NOW");
});

test("recommends intelligent herding for high-confidence inside threats", () => {
  const detection = {
    ...baseDetection,
    id: "threat-002",
    location: "INSIDE_BUILDING",
    detectedZone: "SCIENCE_WING",
  };
  const insideHistory = [
    {
      id: "inc-5",
      threatType: "armed_intruder",
      location: "INSIDE_BUILDING",
      detectedZone: "SCIENCE_WING",
      destinationZone: "LIBRARY",
      strategy: "INTELLIGENT_HERDING",
      successful: true,
    },
    {
      id: "inc-6",
      threatType: "armed_intruder",
      location: "INSIDE_BUILDING",
      detectedZone: "SCIENCE_WING",
      destinationZone: "LIBRARY",
      strategy: "INTELLIGENT_HERDING",
      successful: true,
    },
  ];

  const result = emergency.analyzeThreat(detection, insideHistory);
  assert.equal(result.meetsThreshold, true);
  assert.equal(result.recommendation.strategy, "INTELLIGENT_HERDING");
  assert.deepEqual(result.recommendation.gatePlan.lockGateIds, [
    "SCP-B07",
    "SCP-B08",
    "FRONT-DG03",
  ]);
  assert.equal(result.recommendation.broadcast.scope, "ROOM_SPECIFIC");
});

test("adapts herding plan when threat changes direction", () => {
  const detection = {
    ...baseDetection,
    id: "threat-003",
    location: "INSIDE_BUILDING",
    detectedZone: "SCIENCE_WING",
  };
  const insideHistory = [
    {
      id: "inc-7",
      threatType: "armed_intruder",
      location: "INSIDE_BUILDING",
      detectedZone: "SCIENCE_WING",
      destinationZone: "LIBRARY",
      strategy: "INTELLIGENT_HERDING",
      successful: true,
    },
  ];

  const result = emergency.analyzeThreat(detection, insideHistory);
  const adapted = emergency.adaptHerdingStrategy(result.recommendation, "OVAL");
  assert.deepEqual(adapted.gatePlan.lockGateIds, ["TF-ENTRY", "TF-EXIT", "SCP-B02"]);
  assert.equal(adapted.gatePlan.containmentZone, "OVAL");
});

test("requires operator approval before execution", async () => {
  const highConfidenceHistory = historical.map((incident) => ({ ...incident, successful: true }));
  const analysis = emergency.analyzeThreat(baseDetection, highConfidenceHistory);

  const response = await emergency.executeApprovedResponse(
    analysis,
    {
      approved: false,
      operatorId: "operator-1",
      approvedAtIso: "2026-09-07T21:00:00.000Z",
    },
    {
      lockGates: async () => ({ durationMs: 1000 }),
      unlockEvacuationRoutes: async () => {},
      broadcast: async () => {},
      trackEvacuation: async () => ({ evacuatedPeople: 100, totalPeople: 100 }),
      alertPolice: async () => {},
    },
  );

  assert.equal(response.executed, false);
  assert.match(response.reason, /did not approve/i);
});

test("executes approved response, police alert, and evacuation tracking", async () => {
  const highConfidenceHistory = historical.map((incident) => ({ ...incident, successful: true }));
  const analysis = emergency.analyzeThreat(baseDetection, highConfidenceHistory);

  const calls = [];
  const response = await emergency.executeApprovedResponse(
    analysis,
    {
      approved: true,
      operatorId: "operator-2",
      approvedAtIso: "2026-09-07T21:01:00.000Z",
    },
    {
      lockGates: async (gateIds) => {
        calls.push(["lock", gateIds.length]);
        return { durationMs: 9000 };
      },
      unlockEvacuationRoutes: async (routeIds) => {
        calls.push(["unlock", routeIds.length]);
      },
      broadcast: async (payload) => {
        calls.push(["broadcast", payload.message]);
      },
      trackEvacuation: async () => {
        calls.push(["evacuation"]);
        return { evacuatedPeople: 450, totalPeople: 500 };
      },
      alertPolice: async (payload) => {
        calls.push(["police", payload.zone]);
      },
    },
  );

  assert.equal(response.executed, true);
  assert.equal(response.lockDurationMs, 9000);
  assert.equal(response.evacuationProgress, 90);
  assert.deepEqual(calls, [
    ["lock", 17],
    ["unlock", 3],
    ["broadcast", "EVACUATE NOW"],
    ["police", "NORTH_FENCE"],
    ["evacuation"],
  ]);
});

test("builds AI learning log with strategy and gate performance metrics", () => {
  const analysis = {
    threatId: "threat-004",
    confidencePercent: 99,
    similarIncidents: [historical[0], historical[1]],
    predictedDestination: "GYMNASIUM",
  };

  const execution = {
    executed: true,
    strategy: "FULL_PERIMETER_LOCKDOWN",
    evacuationProgress: 96,
    lockDurationMs: 8400,
  };

  const log = emergency.buildAiLearningLog(analysis, execution, {
    "SCP-B01": 500,
    "SCP-B02": 300,
    "FRONT-DG01": 700,
  });

  assert.equal(log.threatBehaviorPattern.predictedDestination, "GYMNASIUM");
  assert.equal(log.strategyEffectiveness.executed, true);
  assert.equal(log.responseTimeBenchmark.averageGateDurationMs, 500);
  assert.deepEqual(log.gatePerformance.fastestGate, ["SCP-B02", 300]);
  assert.deepEqual(log.gatePerformance.slowestGate, ["FRONT-DG01", 700]);
});
