export type ThreatLocation = "OUTSIDE_PERIMETER" | "INSIDE_BUILDING";
export type Strategy = "FULL_PERIMETER_LOCKDOWN" | "INTELLIGENT_HERDING";

export type SensorReading = {
  confidencePercent: number;
  distanceMeters: number;
  timestampMs: number;
};

export type ThreatDetection = {
  id: string;
  threatType: string;
  location: ThreatLocation;
  detectedZone: string;
  thermal: SensorReading;
  radar: SensorReading;
  video: SensorReading;
};

export type HistoricalIncident = {
  id: string;
  threatType: string;
  location: ThreatLocation;
  detectedZone: string;
  destinationZone: string;
  strategy: Strategy;
  successful: boolean;
};

export type SensorFusionResult = {
  sensorFusionConfidence: number;
  approachSpeedMps: number;
  etaToPerimeterSeconds: number | null;
};

export type Recommendation = {
  strategy: Strategy;
  confidencePercent: number;
  requiredOperatorApproval: true;
  gatePlan: {
    lockGateIds: string[];
    unlockEvacuationRouteIds: string[];
    containmentZone: string;
  };
  broadcast: {
    scope: "ALL_ROOMS" | "ROOM_SPECIFIC";
    message: string;
    roomRoutes?: Record<string, string>;
  };
  policeAlert: {
    required: true;
    location: ThreatLocation;
    zone: string;
  };
};

export type AnalysisResult = {
  threatId: string;
  confidencePercent: number;
  meetsThreshold: boolean;
  sensorFusionConfidence: number;
  historicalAccuracyPercent: number;
  similarIncidents: HistoricalIncident[];
  predictedDestination: string;
  recommendation: Recommendation | null;
  auditTrail: string[];
};

export const EXTERNAL_GATES = [
  "TF-ENTRY",
  "TF-EXIT",
  "SCP-B01",
  "SCP-B02",
  "SCP-B03",
  "SCP-B04",
  "SCP-B05",
  "SCP-B06",
  "SCP-B07",
  "SCP-B08",
  "SCP-B09",
  "SCP-B10",
  "SCP-B11",
  "SCP-B12",
  "FRONT-DG01",
  "FRONT-DG02",
  "FRONT-DG03",
] as const;

const DEFAULT_EVAC_ROUTES = ["EVAC-NORTH", "EVAC-SOUTH", "EVAC-WEST"];
const HERDING_GATE_MAP: Record<string, string[]> = {
  GYMNASIUM: ["FRONT-DG01", "FRONT-DG02", "SCP-B11"],
  OVAL: ["TF-ENTRY", "TF-EXIT", "SCP-B02"],
  LIBRARY: ["SCP-B07", "SCP-B08", "FRONT-DG03"],
  ADMIN: ["SCP-B01", "SCP-B03", "FRONT-DG01"],
};

function round(value: number, places = 2) {
  return Number(value.toFixed(places));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function calculateSensorFusion(detection: ThreatDetection): SensorFusionResult {
  const sensorFusionConfidence = round(
    (detection.thermal.confidencePercent +
      detection.radar.confidencePercent +
      detection.video.confidencePercent) /
      3,
  );

  const deltaDistanceMeters = detection.radar.distanceMeters - detection.video.distanceMeters;
  const deltaTimeSeconds =
    Math.max(detection.video.timestampMs, detection.radar.timestampMs) -
    Math.min(detection.video.timestampMs, detection.radar.timestampMs);
  const approachSpeedMps =
    deltaTimeSeconds > 0 ? round(Math.max(0, (deltaDistanceMeters / deltaTimeSeconds) * 1000)) : 0;
  const etaToPerimeterSeconds =
    approachSpeedMps > 0 ? round(detection.video.distanceMeters / approachSpeedMps) : null;

  return {
    sensorFusionConfidence,
    approachSpeedMps,
    etaToPerimeterSeconds,
  };
}

export function searchSimilarIncidents(
  detection: ThreatDetection,
  historicalIncidents: HistoricalIncident[],
  limit = 5,
) {
  return historicalIncidents
    .map((incident) => {
      const score =
        (incident.threatType === detection.threatType ? 3 : 0) +
        (incident.location === detection.location ? 2 : 0) +
        (incident.detectedZone === detection.detectedZone ? 1 : 0);
      return { incident, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.incident);
}

export function historicalAccuracyPercent(similarIncidents: HistoricalIncident[]) {
  if (similarIncidents.length === 0) return 98;
  const successCount = similarIncidents.filter((incident) => incident.successful).length;
  return round((successCount / similarIncidents.length) * 100);
}

export function predictThreatMovement(
  detection: ThreatDetection,
  similarIncidents: HistoricalIncident[],
) {
  if (similarIncidents.length === 0) return detection.detectedZone;

  const destinationCounts = similarIncidents.reduce<Record<string, number>>((acc, incident) => {
    acc[incident.destinationZone] = (acc[incident.destinationZone] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(destinationCounts).sort((a, b) => b[1] - a[1])[0][0];
}

export function createHerdingPlan(predictedDestination: string) {
  return HERDING_GATE_MAP[predictedDestination] ?? HERDING_GATE_MAP.GYMNASIUM;
}

export function analyzeThreat(
  detection: ThreatDetection,
  historicalIncidents: HistoricalIncident[],
  options?: {
    externalGateIds?: readonly string[];
    evacuationRouteIds?: string[];
    roomRoutes?: Record<string, string>;
  },
): AnalysisResult {
  const fusion = calculateSensorFusion(detection);
  const similarIncidents = searchSimilarIncidents(detection, historicalIncidents);
  const historicalAccuracy = historicalAccuracyPercent(similarIncidents);
  const confidencePercent = round((fusion.sensorFusionConfidence + historicalAccuracy) / 2);
  const meetsThreshold = confidencePercent >= 98;
  const predictedDestination = predictThreatMovement(detection, similarIncidents);

  const auditTrail = [
    `THREAT_DETECTED:${detection.id}`,
    `SENSOR_FUSION:${fusion.sensorFusionConfidence}`,
    `HISTORICAL_ACCURACY:${historicalAccuracy}`,
    `CONFIDENCE_FORMULA:(sensor+historical)/2=${confidencePercent}`,
    `THRESHOLD_CHECK:${meetsThreshold ? "PASS" : "FAIL"}`,
  ];

  if (!meetsThreshold) {
    return {
      threatId: detection.id,
      confidencePercent,
      meetsThreshold,
      sensorFusionConfidence: fusion.sensorFusionConfidence,
      historicalAccuracyPercent: historicalAccuracy,
      similarIncidents,
      predictedDestination,
      recommendation: null,
      auditTrail,
    };
  }

  const evacuationRouteIds = options?.evacuationRouteIds ?? DEFAULT_EVAC_ROUTES;
  const externalGateIds = [...(options?.externalGateIds ?? EXTERNAL_GATES)];
  const isOutside = detection.location === "OUTSIDE_PERIMETER";

  const recommendation: Recommendation = {
    strategy: isOutside ? "FULL_PERIMETER_LOCKDOWN" : "INTELLIGENT_HERDING",
    confidencePercent,
    requiredOperatorApproval: true,
    gatePlan: {
      lockGateIds: isOutside ? externalGateIds : createHerdingPlan(predictedDestination),
      unlockEvacuationRouteIds: evacuationRouteIds,
      containmentZone: isOutside ? "PERIMETER" : predictedDestination,
    },
    broadcast: isOutside
      ? {
          scope: "ALL_ROOMS",
          message: "EVACUATE NOW",
        }
      : {
          scope: "ROOM_SPECIFIC",
          message: "Follow room evacuation route away from threat.",
          roomRoutes: options?.roomRoutes ?? {
            "Room A": "Exit via EVAC-NORTH",
            "Room B": "Exit via EVAC-SOUTH",
            "Room C": "Exit via EVAC-WEST",
          },
        },
    policeAlert: {
      required: true,
      location: detection.location,
      zone: detection.detectedZone,
    },
  };

  return {
    threatId: detection.id,
    confidencePercent,
    meetsThreshold,
    sensorFusionConfidence: fusion.sensorFusionConfidence,
    historicalAccuracyPercent: historicalAccuracy,
    similarIncidents,
    predictedDestination,
    recommendation,
    auditTrail,
  };
}

export function adaptHerdingStrategy(current: Recommendation, newPredictedDestination: string) {
  if (current.strategy !== "INTELLIGENT_HERDING") return current;

  return {
    ...current,
    gatePlan: {
      ...current.gatePlan,
      lockGateIds: createHerdingPlan(newPredictedDestination),
      containmentZone: newPredictedDestination,
    },
  };
}

export type OperatorApproval = {
  approved: boolean;
  operatorId: string;
  approvedAtIso: string;
};

export type ResponseExecutionDependencies = {
  lockGates: (gateIds: string[]) => Promise<{ durationMs: number }>;
  unlockEvacuationRoutes: (routeIds: string[]) => Promise<void>;
  broadcast: (payload: Recommendation["broadcast"]) => Promise<void>;
  trackEvacuation: () => Promise<{ evacuatedPeople: number; totalPeople: number }>;
  alertPolice: (payload: Recommendation["policeAlert"]) => Promise<void>;
};

export type ResponseExecutionResult = {
  executed: boolean;
  reason?: string;
  strategy?: Strategy;
  evacuationProgress?: number;
  lockDurationMs?: number;
  auditTrail: string[];
};

export async function executeApprovedResponse(
  analysis: AnalysisResult,
  approval: OperatorApproval,
  dependencies: ResponseExecutionDependencies,
): Promise<ResponseExecutionResult> {
  const auditTrail = [...analysis.auditTrail];

  if (!analysis.recommendation) {
    auditTrail.push("EXECUTION_SKIPPED:NO_QUALIFYING_RECOMMENDATION");
    return { executed: false, reason: "No recommendation met the confidence threshold.", auditTrail };
  }

  if (!approval.approved) {
    auditTrail.push("EXECUTION_SKIPPED:OPERATOR_REJECTED");
    return { executed: false, reason: "Operator did not approve the response.", auditTrail };
  }

  auditTrail.push(`OPERATOR_APPROVAL:${approval.operatorId}@${approval.approvedAtIso}`);

  const lockResult = await dependencies.lockGates(analysis.recommendation.gatePlan.lockGateIds);
  await dependencies.unlockEvacuationRoutes(analysis.recommendation.gatePlan.unlockEvacuationRouteIds);
  await dependencies.broadcast(analysis.recommendation.broadcast);
  await dependencies.alertPolice(analysis.recommendation.policeAlert);
  const evacuation = await dependencies.trackEvacuation();

  const evacuationProgress =
    evacuation.totalPeople > 0
      ? clampPercent(round((evacuation.evacuatedPeople / evacuation.totalPeople) * 100))
      : 100;

  auditTrail.push("EXECUTED:LOCK_GATES");
  auditTrail.push("EXECUTED:UNLOCK_EVACUATION_ROUTES");
  auditTrail.push("EXECUTED:BROADCAST");
  auditTrail.push("EXECUTED:ALERT_POLICE");
  auditTrail.push(`EVACUATION_PROGRESS:${evacuationProgress}`);

  return {
    executed: true,
    strategy: analysis.recommendation.strategy,
    evacuationProgress,
    lockDurationMs: lockResult.durationMs,
    auditTrail,
  };
}

export function buildAiLearningLog(
  analysis: AnalysisResult,
  execution: ResponseExecutionResult,
  gatePerformanceMs: Record<string, number>,
) {
  const gateDurations = Object.values(gatePerformanceMs);
  const slowestGate = Object.entries(gatePerformanceMs).sort((a, b) => b[1] - a[1])[0] ?? null;
  const fastestGate = Object.entries(gatePerformanceMs).sort((a, b) => a[1] - b[1])[0] ?? null;

  return {
    threatId: analysis.threatId,
    learnedAtIso: new Date().toISOString(),
    threatBehaviorPattern: {
      predictedDestination: analysis.predictedDestination,
      similarIncidentCount: analysis.similarIncidents.length,
    },
    strategyEffectiveness: {
      strategy: execution.strategy ?? "NONE",
      confidencePercent: analysis.confidencePercent,
      executed: execution.executed,
      evacuationProgress: execution.evacuationProgress ?? 0,
    },
    responseTimeBenchmark: {
      lockDurationMs: execution.lockDurationMs ?? 0,
      averageGateDurationMs:
        gateDurations.length > 0 ? round(gateDurations.reduce((a, b) => a + b, 0) / gateDurations.length) : 0,
    },
    evacuationPattern: {
      finalProgressPercent: execution.evacuationProgress ?? 0,
    },
    gatePerformance: {
      fastestGate,
      slowestGate,
    },
  };
}
