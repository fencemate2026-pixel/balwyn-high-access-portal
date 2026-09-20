export interface ThermalDetection {
  distance_from_gate: number;
  gate_approach: "FRONT" | "SPORTS" | "STAFF" | "EMERGENCY";
  approach_vector: number;
  approach_speed: number;
  detection_confidence: number;
  weapon_identified?: boolean;
}

export interface RadarDetection {
  distance_from_gate: number;
  gate_approach: "FRONT" | "SPORTS" | "STAFF" | "EMERGENCY";
  approach_vector: number;
  approach_speed: number;
  detection_confidence: number;
}

export interface VideoDetection {
  distance_from_gate: number;
  gate_approach: "FRONT" | "SPORTS" | "STAFF" | "EMERGENCY";
  approach_vector: number;
  approach_speed: number;
  detection_confidence: number;
  weapon_identified?: boolean;
}

export interface PerimeterThreatDetection {
  detection_source: "THERMAL" | "RADAR" | "VIDEO" | "FUSION";
  threat_location: {
    distance_from_gate: number;
    gate_approach: "FRONT" | "SPORTS" | "STAFF" | "EMERGENCY";
    approach_vector: number;
  };
  approach_speed: number;
  time_to_gate_contact: number;
  detection_confidence: number;
  weapon_identified: boolean;
  threat_location_status:
    | "OUTSIDE_PERIMETER"
    | "AT_GATE"
    | "ATTEMPTING_ENTRY"
    | "INSIDE_BUILDING";
  recommended_action: "FULL_LOCKDOWN" | "HEIGHTENED_ALERT" | "MONITOR";
  response_window_seconds: number;
  time_available_to_lock_gates: number;
}

function toLocationStatus(
  distanceFromGate: number,
): PerimeterThreatDetection["threat_location_status"] {
  if (distanceFromGate <= 0) {
    return "INSIDE_BUILDING";
  }
  if (distanceFromGate <= 5) {
    return "ATTEMPTING_ENTRY";
  }
  if (distanceFromGate <= 15) {
    return "AT_GATE";
  }
  return "OUTSIDE_PERIMETER";
}

function toRecommendedAction(
  status: PerimeterThreatDetection["threat_location_status"],
  confidence: number,
): PerimeterThreatDetection["recommended_action"] {
  if (status === "INSIDE_BUILDING") {
    return confidence >= 60 ? "HEIGHTENED_ALERT" : "MONITOR";
  }
  return confidence >= 70 ? "FULL_LOCKDOWN" : "HEIGHTENED_ALERT";
}

export function detect_perimeter_threat(
  thermal_feeds: ThermalDetection[],
  radar_feeds: RadarDetection[],
  video_feeds: VideoDetection[],
): PerimeterThreatDetection {
  const candidates = [
    ...thermal_feeds.map((detection) => ({
      source: "THERMAL" as const,
      ...detection,
    })),
    ...radar_feeds.map((detection) => ({
      source: "RADAR" as const,
      ...detection,
      weapon_identified: false,
    })),
    ...video_feeds.map((detection) => ({
      source: "VIDEO" as const,
      ...detection,
    })),
  ];

  if (!candidates.length) {
    return {
      detection_source: "FUSION",
      threat_location: {
        distance_from_gate: Number.POSITIVE_INFINITY,
        gate_approach: "FRONT",
        approach_vector: 0,
      },
      approach_speed: 0,
      time_to_gate_contact: Number.POSITIVE_INFINITY,
      detection_confidence: 0,
      weapon_identified: false,
      threat_location_status: "OUTSIDE_PERIMETER",
      recommended_action: "MONITOR",
      response_window_seconds: Number.POSITIVE_INFINITY,
      time_available_to_lock_gates: Number.POSITIVE_INFINITY,
    };
  }

  const nearestDetection = candidates.reduce((nearest, detection) =>
    detection.distance_from_gate < nearest.distance_from_gate ? detection : nearest,
  );
  const detectionSource =
    new Set(candidates.map((candidate) => candidate.source)).size > 1
      ? "FUSION"
      : nearestDetection.source;
  const weaponIdentified = candidates.some((candidate) => candidate.weapon_identified);
  const confidenceTotal = candidates.reduce(
    (sum, detection) => sum + detection.detection_confidence,
    0,
  );
  const averageConfidence = confidenceTotal / candidates.length;
  const detectionConfidence = Math.min(
    100,
    Math.round(averageConfidence + (weaponIdentified ? 10 : 0)),
  );
  const approachSpeed = Math.max(0, nearestDetection.approach_speed);
  const timeToGateContact =
    approachSpeed > 0
      ? Math.max(0, nearestDetection.distance_from_gate) / approachSpeed
      : Number.POSITIVE_INFINITY;
  const threatLocationStatus = toLocationStatus(nearestDetection.distance_from_gate);
  const responseWindowSeconds = Number.isFinite(timeToGateContact)
    ? timeToGateContact
    : 0;

  return {
    detection_source: detectionSource,
    threat_location: {
      distance_from_gate: nearestDetection.distance_from_gate,
      gate_approach: nearestDetection.gate_approach,
      approach_vector: nearestDetection.approach_vector,
    },
    approach_speed: approachSpeed,
    time_to_gate_contact: timeToGateContact,
    detection_confidence: detectionConfidence,
    weapon_identified: weaponIdentified,
    threat_location_status: threatLocationStatus,
    recommended_action: toRecommendedAction(
      threatLocationStatus,
      detectionConfidence,
    ),
    response_window_seconds: responseWindowSeconds,
    time_available_to_lock_gates: responseWindowSeconds,
  };
}
