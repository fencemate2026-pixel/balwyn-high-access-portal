import { average, roundScore, type IncidentRecord, type ThreatDetection } from './types';

export interface HistoricalAnalysis {
  similar_past_incidents: IncidentRecord[];
  threat_behavior_pattern: {
    typical_speed: { min: number; max: number };
    typical_direction: string;
    typical_escape_routes: string[];
    current_behavior_matches_pattern: boolean;
    pattern_match_confidence: number;
  };
  historical_recommendation_accuracy: {
    total_past_recommendations: number;
    successful_recommendations: number;
    accuracy_percentage: number;
  };
  historical_confidence: number;
  meets_threshold: boolean;
  reasoning: string;
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'unknown';
}

export function analyze_historical_patterns(
  threat: ThreatDetection,
  incident_database: IncidentRecord[],
): HistoricalAnalysis {
  const similar_past_incidents = incident_database.filter((incident) => incident.threatType === threat.type);
  const speeds = similar_past_incidents.map((incident) => incident.speed);
  const directions = similar_past_incidents.map((incident) => incident.direction);
  const escapeRoutes = similar_past_incidents.flatMap((incident) => incident.escapeRoutes ?? []);
  const successful_recommendations = similar_past_incidents.filter((incident) => incident.result === 'successful').length;
  const accuracy_percentage = similar_past_incidents.length
    ? roundScore((successful_recommendations / similar_past_incidents.length) * 100)
    : 0;

  const typical_speed = {
    min: speeds.length ? Math.min(...speeds) : threat.speed,
    max: speeds.length ? Math.max(...speeds) : threat.speed,
  };
  const typical_direction = mostCommon(directions);
  const current_behavior_matches_pattern =
    threat.speed >= typical_speed.min &&
    threat.speed <= typical_speed.max &&
    threat.direction === typical_direction;
  const pattern_match_confidence = roundScore(
    similar_past_incidents.length === 0
      ? 0
      : average([
          current_behavior_matches_pattern ? 98 : 68,
          similar_past_incidents.some((incident) => incident.predictedDestination === threat.predictedDestination) ? 97 : 72,
          Math.min(100, 80 + similar_past_incidents.length * 5),
        ]),
  );

  const historical_confidence = roundScore(
    similar_past_incidents.length === 0 ? 0 : average([pattern_match_confidence, accuracy_percentage]),
  );

  return {
    similar_past_incidents,
    threat_behavior_pattern: {
      typical_speed,
      typical_direction,
      typical_escape_routes: [...new Set(escapeRoutes)],
      current_behavior_matches_pattern,
      pattern_match_confidence,
    },
    historical_recommendation_accuracy: {
      total_past_recommendations: similar_past_incidents.length,
      successful_recommendations,
      accuracy_percentage,
    },
    historical_confidence,
    meets_threshold: historical_confidence >= 90,
    reasoning: similar_past_incidents.length
      ? `${similar_past_incidents.length} similar incidents were found with ${accuracy_percentage}% historical success, producing a ${historical_confidence}% historical confidence score.`
      : 'No similar verified incidents were found, so historical support is insufficient for a targeted recommendation.',
  };
}
