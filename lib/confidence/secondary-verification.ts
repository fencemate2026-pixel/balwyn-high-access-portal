import {
  average,
  roundScore,
  type CameraFeed,
  type OccupancySystem,
  type ThreatDetection,
} from './types';

export interface SecondaryVerification {
  multi_camera_verification: {
    camera_count: number;
    all_cameras_agree: boolean;
    agreement_confidence: number;
  };
  velocity_verification: {
    measured_velocity: number;
    expected_range: { min: number; max: number };
    velocity_matches: boolean;
    confidence: number;
  };
  emergency_button_activation: {
    activated: boolean;
    button_location: string;
    timestamp: Date;
  };
  occupancy_system_independent_check: {
    badge_reader_agrees: boolean;
    thermal_agrees: boolean;
    radar_agrees: boolean;
  };
  secondary_confidence: number;
  meets_threshold: boolean;
  reasoning: string;
}

export function perform_secondary_verification(
  threat: ThreatDetection,
  all_cameras: CameraFeed[],
  occupancy_system: OccupancySystem,
): SecondaryVerification {
  const measured_velocity = roundScore(
    average(all_cameras.map((camera) => camera.measuredVelocity)),
  );
  const expected_range = threat.expectedVelocityRange ?? { min: Math.max(0, threat.speed - 0.4), max: threat.speed + 0.4 };
  const all_cameras_agree =
    all_cameras.every((camera) => camera.seesThreat) &&
    new Set(all_cameras.map((camera) => camera.predictedDestination)).size === 1;
  const agreement_confidence = roundScore(
    average(all_cameras.map((camera) => camera.confidence)) +
      (all_cameras_agree ? 2 : -12),
  );
  const velocity_matches = measured_velocity >= expected_range.min && measured_velocity <= expected_range.max;
  const velocityConfidence = velocity_matches ? 98 : 64;
  const occupancyAgreement = [
    occupancy_system.badgeReaderAgrees,
    occupancy_system.thermalAgrees,
    occupancy_system.radarAgrees,
  ].every(Boolean);
  const occupancyConfidence = occupancyAgreement ? 98 : 54;
  const buttonConfidence = occupancy_system.emergencyButtonActivated ? 100 : 97;
  const secondary_confidence = roundScore(
    average([
      agreement_confidence,
      velocityConfidence,
      occupancyConfidence,
      buttonConfidence,
    ]),
  );

  return {
    multi_camera_verification: {
      camera_count: all_cameras.length,
      all_cameras_agree,
      agreement_confidence,
    },
    velocity_verification: {
      measured_velocity,
      expected_range,
      velocity_matches,
      confidence: velocityConfidence,
    },
    emergency_button_activation: {
      activated: occupancy_system.emergencyButtonActivated,
      button_location: occupancy_system.buttonLocation,
      timestamp: occupancy_system.buttonTimestamp,
    },
    occupancy_system_independent_check: {
      badge_reader_agrees: occupancy_system.badgeReaderAgrees,
      thermal_agrees: occupancy_system.thermalAgrees,
      radar_agrees: occupancy_system.radarAgrees,
    },
    secondary_confidence,
    meets_threshold: secondary_confidence >= 95,
    reasoning: all_cameras_agree && velocity_matches && occupancyAgreement
      ? `Independent cross-checks from ${all_cameras.length} cameras, velocity tracking and occupancy services agree on the current threat path.`
      : 'One or more independent cross-checks disagree with the primary recommendation, so secondary verification cannot clear the action.',
  };
}
