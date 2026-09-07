import {
  average,
  roundScore,
  type RadarDetection,
  type ThermalDetection,
  type VideoDetection,
} from './types';

export interface SensorConfidenceScore {
  thermal_confidence: number;
  radar_confidence: number;
  video_confidence: number;
  fusion_method: 'average' | 'weighted' | 'bayesian';
  fused_confidence: number;
  component_scores: {
    thermal: { value: number; threshold_met: boolean };
    radar: { value: number; threshold_met: boolean };
    video: { value: number; threshold_met: boolean };
  };
  all_thresholds_met: boolean;
  meets_98_threshold: boolean;
  reasoning: string;
  recommendation_eligible: boolean;
}

export function calculate_sensor_fusion_confidence(
  thermal: ThermalDetection,
  radar: RadarDetection,
  video: VideoDetection,
): SensorConfidenceScore {
  const component_scores = {
    thermal: { value: roundScore(thermal.confidence), threshold_met: thermal.confidence >= 90 },
    radar: { value: roundScore(radar.confidence), threshold_met: radar.confidence >= 90 },
    video: { value: roundScore(video.confidence), threshold_met: video.confidence >= 95 },
  };

  const all_thresholds_met = Object.values(component_scores).every((score) => score.threshold_met);
  const baselineAverage = average([
    component_scores.thermal.value,
    component_scores.radar.value,
    component_scores.video.value,
  ]);
  const weakestSignal = Math.min(
    component_scores.thermal.value,
    component_scores.radar.value,
    component_scores.video.value,
  );
  const consensusBonus = all_thresholds_met ? Math.max(0, weakestSignal - 90) * 0.2 : 0;
  const fused_confidence = roundScore(baselineAverage + consensusBonus);
  const meets_98_threshold = fused_confidence >= 98;

  return {
    thermal_confidence: component_scores.thermal.value,
    radar_confidence: component_scores.radar.value,
    video_confidence: component_scores.video.value,
    fusion_method: 'average',
    fused_confidence,
    component_scores,
    all_thresholds_met,
    meets_98_threshold,
    recommendation_eligible: all_thresholds_met && meets_98_threshold,
    reasoning: all_thresholds_met
      ? `Thermal ${component_scores.thermal.value}%, radar ${component_scores.radar.value}% and video ${component_scores.video.value}% all cleared their individual thresholds. Consensus uplift raised the fused score to ${fused_confidence}%.`
      : `One or more sensors missed the minimum threshold (thermal 90%, radar 90%, video 95%), so the fused score is limited to ${fused_confidence}% and specific recommendations are blocked.`,
  };
}
