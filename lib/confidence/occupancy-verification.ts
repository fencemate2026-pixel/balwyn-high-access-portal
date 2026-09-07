import { average, roundScore, type ThreatPath, type Zone } from './types';

export interface OccupancyVerification {
  target_zone_id: string;
  thermal_occupancy_check: {
    method: 'thermal_imaging';
    occupancy_count: number;
    confidence: number;
  };
  radar_occupancy_check: {
    method: 'radar_motion_detection';
    movement_detected: boolean;
    confidence: number;
  };
  system_occupancy_check: {
    method: 'badge_reader_data';
    occupancy_count: number;
    last_updated: Date;
  };
  consensus: {
    zone_is_empty: boolean;
    path_is_clear: boolean;
    adjacent_accessible: boolean;
  };
  occupancy_confidence: number;
  meets_threshold: boolean;
  reasoning: string;
}

export function verify_occupancy_independent(
  zone: Zone,
  threat_path: ThreatPath,
): OccupancyVerification {
  const thermalConfidence = zone.thermalOccupancyCount === 0 ? 99 : 42;
  const radarConfidence = !zone.radarMotionDetected ? 98 : 38;
  const badgeConfidence = zone.badgeOccupancyCount === 0 ? 97 : 35;

  const consensus = {
    zone_is_empty:
      zone.thermalOccupancyCount === 0 &&
      !zone.radarMotionDetected &&
      zone.badgeOccupancyCount === 0,
    path_is_clear: zone.pathClear && threat_path.pathIsClear,
    adjacent_accessible:
      zone.adjacentZonesAccessible && threat_path.adjacentRoutesAvailable,
  };

  const baseConfidence = average([
    thermalConfidence,
    radarConfidence,
    badgeConfidence,
  ]);
  const safetyBonus =
    consensus.zone_is_empty &&
    consensus.path_is_clear &&
    consensus.adjacent_accessible &&
    threat_path.fireExitsRemainAccessible &&
    zone.fireExitsAccessible
      ? 2.5
      : -18;
  const occupancy_confidence = roundScore(baseConfidence + safetyBonus);

  return {
    target_zone_id: zone.id,
    thermal_occupancy_check: {
      method: 'thermal_imaging',
      occupancy_count: zone.thermalOccupancyCount,
      confidence: thermalConfidence,
    },
    radar_occupancy_check: {
      method: 'radar_motion_detection',
      movement_detected: zone.radarMotionDetected,
      confidence: radarConfidence,
    },
    system_occupancy_check: {
      method: 'badge_reader_data',
      occupancy_count: zone.badgeOccupancyCount,
      last_updated: new Date(),
    },
    consensus,
    occupancy_confidence,
    meets_threshold: occupancy_confidence >= 95,
    reasoning: consensus.zone_is_empty && consensus.path_is_clear && consensus.adjacent_accessible
      ? `Thermal, radar and badge data independently verify that ${zone.name} is empty and the route into the zone remains clear.`
      : `Independent occupancy checks disagree or show blocked egress around ${zone.name}, so the zone cannot be used for targeted containment.`,
  };
}
