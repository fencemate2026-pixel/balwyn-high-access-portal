import type { HistoricalAnalysis } from './historical-analysis';
import type { OccupancyVerification } from './occupancy-verification';
import type { SecondaryVerification } from './secondary-verification';
import type { SafetyConstraints } from './safety-constraints';
import type { SensorConfidenceScore } from './sensor-fusion-scoring';
import { layerThresholds, roundScore } from './types';

export interface FinalConfidenceScore {
  layer_1_sensor_fusion: number;
  layer_2_occupancy: number;
  layer_3_historical: number;
  layer_4_secondary: number;
  layer_5_safety: number;
  weighted_confidence: number;
  all_layers_pass: boolean;
  recommendation_confidence: number;
  can_show_to_operator: boolean;
  detailed_breakdown: {
    layer: string;
    score: number;
    threshold: number;
    meets_threshold: boolean;
    reasoning: string;
  }[];
  action_if_below_threshold: 'SHOW_RECOMMENDATION' | 'AUTO_ESCALATE_TO_FULL_LOCKDOWN';
}

export function calculate_final_confidence(
  sensor_fusion: SensorConfidenceScore,
  occupancy: OccupancyVerification,
  historical: HistoricalAnalysis,
  secondary: SecondaryVerification,
  safety: SafetyConstraints,
): FinalConfidenceScore {
  const detailed_breakdown = [
    {
      layer: 'Sensor fusion',
      score: sensor_fusion.fused_confidence,
      threshold: layerThresholds.sensorFusion,
      meets_threshold: sensor_fusion.meets_98_threshold,
      reasoning: sensor_fusion.reasoning,
    },
    {
      layer: 'Occupancy',
      score: occupancy.occupancy_confidence,
      threshold: layerThresholds.occupancy,
      meets_threshold: occupancy.meets_threshold,
      reasoning: occupancy.reasoning,
    },
    {
      layer: 'Historical',
      score: historical.historical_confidence,
      threshold: layerThresholds.historical,
      meets_threshold: historical.meets_threshold,
      reasoning: historical.reasoning,
    },
    {
      layer: 'Secondary',
      score: secondary.secondary_confidence,
      threshold: layerThresholds.secondary,
      meets_threshold: secondary.meets_threshold,
      reasoning: secondary.reasoning,
    },
    {
      layer: 'Safety',
      score: safety.safety_confidence,
      threshold: layerThresholds.safety,
      meets_threshold: safety.all_safety_checks_pass,
      reasoning: safety.reasoning,
    },
  ];

  const weighted_confidence = roundScore(
    sensor_fusion.fused_confidence * 0.32 +
      occupancy.occupancy_confidence * 0.2 +
      historical.historical_confidence * 0.13 +
      secondary.secondary_confidence * 0.2 +
      safety.safety_confidence * 0.15,
  );
  const all_layers_pass = detailed_breakdown.every((layer) => layer.meets_threshold);
  const recommendation_confidence =
    all_layers_pass && weighted_confidence >= 99.5
      ? 100
      : roundScore(
          all_layers_pass ? Math.min(100, weighted_confidence + 0.3) : weighted_confidence,
        );
  const can_show_to_operator = all_layers_pass && recommendation_confidence >= 98;

  return {
    layer_1_sensor_fusion: sensor_fusion.fused_confidence,
    layer_2_occupancy: occupancy.occupancy_confidence,
    layer_3_historical: historical.historical_confidence,
    layer_4_secondary: secondary.secondary_confidence,
    layer_5_safety: safety.safety_confidence,
    weighted_confidence,
    all_layers_pass,
    recommendation_confidence,
    can_show_to_operator,
    detailed_breakdown,
    action_if_below_threshold: can_show_to_operator
      ? 'SHOW_RECOMMENDATION'
      : 'AUTO_ESCALATE_TO_FULL_LOCKDOWN',
  };
}
