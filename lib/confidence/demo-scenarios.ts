import { calculate_final_confidence } from './confidence-calculator';
import { determine_escalation_decision } from './escalation-logic';
import { analyze_historical_patterns } from './historical-analysis';
import { verify_occupancy_independent } from './occupancy-verification';
import { perform_secondary_verification } from './secondary-verification';
import { verify_safety_constraints } from './safety-constraints';
import { calculate_sensor_fusion_confidence } from './sensor-fusion-scoring';
import type {
  CameraFeed,
  IncidentRecord,
  OccupancySystem,
  RecommendationPlan,
  ThreatDetection,
  ThreatPath,
  Zone,
} from './types';

export type ScenarioKind =
  | 'high-confidence'
  | 'low-confidence'
  | 'sensor-failure'
  | 'occupancy-failure'
  | 'false-positive'
  | 'moved-threat'
  | 'fire';

export interface ConfidenceScenario {
  kind: ScenarioKind;
  threat: ThreatDetection;
  plan: RecommendationPlan;
  sensorFusion: ReturnType<typeof calculate_sensor_fusion_confidence>;
  occupancy: ReturnType<typeof verify_occupancy_independent>;
  historical: ReturnType<typeof analyze_historical_patterns>;
  secondary: ReturnType<typeof perform_secondary_verification>;
  safety: ReturnType<typeof verify_safety_constraints>;
  finalConfidence: ReturnType<typeof calculate_final_confidence>;
  escalation: ReturnType<typeof determine_escalation_decision>;
}

const incidents: IncidentRecord[] = [
  {
    id: 'INC-001',
    threatType: 'firearm',
    location: 'Corridor B',
    speed: 3.1,
    direction: 'east',
    predictedDestination: 'Gymnasium',
    recommendedAction: 'Lock Gate-3 and Gate-4, leave Gate-5 open.',
    result: 'successful',
    escapeRoutes: ['Gate-5'],
  },
  {
    id: 'INC-002',
    threatType: 'firearm',
    location: 'Corridor B',
    speed: 3.3,
    direction: 'east',
    predictedDestination: 'Gymnasium',
    recommendedAction: 'Lock Gate-3 and Gate-4, leave Gate-5 open.',
    result: 'successful',
    escapeRoutes: ['Gate-5'],
  },
  {
    id: 'INC-003',
    threatType: 'firearm',
    location: 'Corridor A',
    speed: 3.2,
    direction: 'east',
    predictedDestination: 'Gymnasium',
    recommendedAction: 'Guide threat to the gym and isolate.',
    result: 'successful',
    escapeRoutes: ['Gate-5'],
  },
  {
    id: 'INC-004',
    threatType: 'intruder',
    location: 'Front Office',
    speed: 2,
    direction: 'north',
    predictedDestination: 'Admin Wing',
    recommendedAction: 'Full lockdown.',
    result: 'failed',
    escapeRoutes: ['Front-Entry'],
  },
  {
    id: 'INC-005',
    threatType: 'fire',
    location: 'Science Block',
    speed: 0.2,
    direction: 'south',
    predictedDestination: 'Oval Assembly',
    recommendedAction: 'Open every gate and guide classroom evacuation.',
    result: 'successful',
    escapeRoutes: ['South Gate', 'Oval Gate'],
  },
  {
    id: 'INC-006',
    threatType: 'fire',
    location: 'Technology Wing',
    speed: 0.2,
    direction: 'south',
    predictedDestination: 'Oval Assembly',
    recommendedAction: 'Open every gate and guide classroom evacuation.',
    result: 'successful',
    escapeRoutes: ['South Gate', 'Oval Gate'],
  },
];

function threatPlan(targetZoneId: string, targetZoneName: string): RecommendationPlan {
  return {
    responseType: 'threat_containment',
    targetZoneId,
    targetZoneName,
    recommendedAction: 'Lock Front Double Gates 01 and 02, keep the sports exit gate open to funnel the threat into the gymnasium containment zone.',
    gates: [
      { gateId: 'FRONT-DG01', instruction: 'LOCK', reason: 'Block escape route A away from classrooms.' },
      { gateId: 'FRONT-DG02', instruction: 'LOCK', reason: 'Block escape route B toward the cafeteria.' },
      { gateId: 'TF-EXIT', instruction: 'KEEP_OPEN', reason: 'Maintain the single clear path into the containment zone.' },
    ],
    classroomRoutes: [
      { room: 'Room 101', route: 'Shelter in place and secure internal door', destination: 'On-site lockdown' },
      { room: 'Room 204', route: 'Move to the west stairwell safe room', destination: 'Library shelter zone' },
    ],
    rationale: 'All non-fire-exit routes away from the threat stay available for student evacuation while the threat is guided toward the gymnasium.',
  };
}

function firePlan(): RecommendationPlan {
  return {
    responseType: 'fire_evacuation',
    targetZoneId: 'campus-wide',
    targetZoneName: 'Campus-wide evacuation',
    recommendedAction: 'Open every gate and publish room-specific evacuation routes to each classroom projector.',
    gates: [
      { gateId: 'TF-ENTRY', instruction: 'OPEN', reason: 'Provide direct egress from the sports precinct.' },
      { gateId: 'TF-EXIT', instruction: 'OPEN', reason: 'Provide direct egress from the sports precinct.' },
      { gateId: 'FRONT-DG01', instruction: 'OPEN', reason: 'Open a primary supervised exit for front classrooms.' },
      { gateId: 'FRONT-DG02', instruction: 'OPEN', reason: 'Open a primary supervised exit for front classrooms.' },
      { gateId: 'FRONT-DG03', instruction: 'OPEN', reason: 'Open a primary supervised exit for front classrooms.' },
    ],
    classroomRoutes: [
      { room: 'Science Lab 3', route: 'Exit south, turn left, and proceed to the oval assembly point.', destination: 'Oval assembly point' },
      { room: 'Classroom 12', route: 'Use the east corridor, then exit via Front Double Gates 01.', destination: 'Front lawn assembly point' },
      { room: 'Gym Office', route: 'Leave by the sports exit gate and proceed to the tennis court assembly point.', destination: 'Tennis court assembly point' },
    ],
    rationale: 'Fire evacuation keeps every approved egress point open and gives each classroom a projector-safe route to the nearest available assembly point.',
  };
}

function buildInputs(kind: ScenarioKind) {
  switch (kind) {
    case 'high-confidence':
      return {
        thermal: { confidence: 99.4, heatSignature: 92 },
        radar: { confidence: 99.1, speed: 3.2, movementDetected: true, direction: 'east' },
        video: { confidence: 99.6, threatType: 'firearm', identified: true, location: 'Corridor B', predictedDestination: 'Gymnasium', cameraCount: 3 },
        threat: { id: 'TH-001', type: 'firearm', location: 'Corridor B', speed: 3.2, direction: 'east', predictedDestination: 'Gymnasium', expectedVelocityRange: { min: 2.8, max: 3.5 } },
        zone: { id: 'gymnasium', name: 'Gymnasium', thermalOccupancyCount: 0, radarMotionDetected: false, badgeOccupancyCount: 0, pathClear: true, adjacentZonesAccessible: true, fireExitsAccessible: true, escapeRoutesAvailable: true, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'gymnasium', pathIsClear: true, adjacentRoutesAvailable: true, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 99, measuredVelocity: 3.1, predictedDestination: 'Gymnasium' },
          { id: 'CAM-2', seesThreat: true, confidence: 98.7, measuredVelocity: 3.2, predictedDestination: 'Gymnasium' },
          { id: 'CAM-3', seesThreat: true, confidence: 99.2, measuredVelocity: 3.2, predictedDestination: 'Gymnasium' },
        ],
        occupancySystem: { badgeReaderAgrees: true, thermalAgrees: true, radarAgrees: true, emergencyButtonActivated: true, buttonLocation: 'Reception', buttonTimestamp: new Date('2026-09-07T14:23:52Z') },
        plan: threatPlan('gymnasium', 'Gymnasium containment zone'),
      };
    case 'moved-threat':
      return {
        thermal: { confidence: 99.2, heatSignature: 90 },
        radar: { confidence: 98.9, speed: 3.4, movementDetected: true, direction: 'east' },
        video: { confidence: 99.3, threatType: 'firearm', identified: true, location: 'Gymnasium Entry', predictedDestination: 'Gymnasium', cameraCount: 3 },
        threat: { id: 'TH-001', type: 'firearm', location: 'Gymnasium Entry', speed: 3.4, direction: 'east', predictedDestination: 'Gymnasium', expectedVelocityRange: { min: 3, max: 3.6 } },
        zone: { id: 'gymnasium', name: 'Gymnasium', thermalOccupancyCount: 0, radarMotionDetected: false, badgeOccupancyCount: 0, pathClear: true, adjacentZonesAccessible: true, fireExitsAccessible: true, escapeRoutesAvailable: true, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'gymnasium', pathIsClear: true, adjacentRoutesAvailable: true, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 98.8, measuredVelocity: 3.4, predictedDestination: 'Gymnasium' },
          { id: 'CAM-2', seesThreat: true, confidence: 99.1, measuredVelocity: 3.4, predictedDestination: 'Gymnasium' },
          { id: 'CAM-3', seesThreat: true, confidence: 98.9, measuredVelocity: 3.5, predictedDestination: 'Gymnasium' },
        ],
        occupancySystem: { badgeReaderAgrees: true, thermalAgrees: true, radarAgrees: true, emergencyButtonActivated: true, buttonLocation: 'Reception', buttonTimestamp: new Date('2026-09-07T14:23:58Z') },
        plan: {
          ...threatPlan('gymnasium', 'Gymnasium containment zone'),
          recommendedAction: 'Threat is approaching the gymnasium threshold. Lock the sports exit gate immediately after entry while keeping all fire exits clear.',
          gates: [
            { gateId: 'TF-EXIT', instruction: 'LOCK', reason: 'Seal the gymnasium after the threat enters the containment zone.' },
          ],
        },
      };
    case 'low-confidence':
      return {
        thermal: { confidence: 90, heatSignature: 70 },
        radar: { confidence: 88, speed: 2.4, movementDetected: true, direction: 'east' },
        video: { confidence: 91, threatType: 'firearm', identified: true, location: 'Corridor B', predictedDestination: 'Gymnasium', cameraCount: 2 },
        threat: { id: 'TH-002', type: 'firearm', location: 'Corridor B', speed: 2.4, direction: 'east', predictedDestination: 'Gymnasium', expectedVelocityRange: { min: 2.8, max: 3.5 } },
        zone: { id: 'gymnasium', name: 'Gymnasium', thermalOccupancyCount: 0, radarMotionDetected: false, badgeOccupancyCount: 0, pathClear: true, adjacentZonesAccessible: true, fireExitsAccessible: true, escapeRoutesAvailable: true, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'gymnasium', pathIsClear: true, adjacentRoutesAvailable: true, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 91, measuredVelocity: 2.4, predictedDestination: 'Gymnasium' },
          { id: 'CAM-2', seesThreat: false, confidence: 86, measuredVelocity: 2.7, predictedDestination: 'Library' },
        ],
        occupancySystem: { badgeReaderAgrees: true, thermalAgrees: true, radarAgrees: false, emergencyButtonActivated: false, buttonLocation: 'None', buttonTimestamp: new Date('2026-09-07T14:24:03Z') },
        plan: threatPlan('gymnasium', 'Gymnasium containment zone'),
      };
    case 'sensor-failure':
      return {
        thermal: { confidence: 98, heatSignature: 90 },
        radar: { confidence: 74, speed: 3.2, movementDetected: false, direction: 'unknown' },
        video: { confidence: 99, threatType: 'firearm', identified: true, location: 'Corridor B', predictedDestination: 'Gymnasium', cameraCount: 3 },
        threat: { id: 'TH-003', type: 'firearm', location: 'Corridor B', speed: 3.2, direction: 'east', predictedDestination: 'Gymnasium', expectedVelocityRange: { min: 2.8, max: 3.5 } },
        zone: { id: 'gymnasium', name: 'Gymnasium', thermalOccupancyCount: 0, radarMotionDetected: false, badgeOccupancyCount: 0, pathClear: true, adjacentZonesAccessible: true, fireExitsAccessible: true, escapeRoutesAvailable: true, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'gymnasium', pathIsClear: true, adjacentRoutesAvailable: true, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 98, measuredVelocity: 3.2, predictedDestination: 'Gymnasium' },
          { id: 'CAM-2', seesThreat: true, confidence: 98.5, measuredVelocity: 3.1, predictedDestination: 'Gymnasium' },
        ],
        occupancySystem: { badgeReaderAgrees: true, thermalAgrees: true, radarAgrees: true, emergencyButtonActivated: true, buttonLocation: 'Reception', buttonTimestamp: new Date('2026-09-07T14:24:11Z') },
        plan: threatPlan('gymnasium', 'Gymnasium containment zone'),
      };
    case 'occupancy-failure':
      return {
        thermal: { confidence: 99, heatSignature: 92 },
        radar: { confidence: 99, speed: 3.2, movementDetected: true, direction: 'east' },
        video: { confidence: 99, threatType: 'firearm', identified: true, location: 'Corridor B', predictedDestination: 'Gymnasium', cameraCount: 3 },
        threat: { id: 'TH-004', type: 'firearm', location: 'Corridor B', speed: 3.2, direction: 'east', predictedDestination: 'Gymnasium', expectedVelocityRange: { min: 2.8, max: 3.5 } },
        zone: { id: 'gymnasium', name: 'Gymnasium', thermalOccupancyCount: 3, radarMotionDetected: true, badgeOccupancyCount: 2, pathClear: false, adjacentZonesAccessible: false, fireExitsAccessible: true, escapeRoutesAvailable: false, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'gymnasium', pathIsClear: false, adjacentRoutesAvailable: false, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 99, measuredVelocity: 3.1, predictedDestination: 'Gymnasium' },
          { id: 'CAM-2', seesThreat: true, confidence: 98.7, measuredVelocity: 3.2, predictedDestination: 'Gymnasium' },
          { id: 'CAM-3', seesThreat: true, confidence: 99.2, measuredVelocity: 3.2, predictedDestination: 'Gymnasium' },
        ],
        occupancySystem: { badgeReaderAgrees: false, thermalAgrees: false, radarAgrees: false, emergencyButtonActivated: true, buttonLocation: 'Reception', buttonTimestamp: new Date('2026-09-07T14:24:19Z') },
        plan: threatPlan('gymnasium', 'Gymnasium containment zone'),
      };
    case 'false-positive':
      return {
        thermal: { confidence: 89, heatSignature: 55 },
        radar: { confidence: 91, speed: 1.1, movementDetected: true, direction: 'north' },
        video: { confidence: 86, threatType: 'firearm', identified: false, location: 'Courtyard', predictedDestination: 'Admin Wing', cameraCount: 2 },
        threat: { id: 'TH-005', type: 'intruder', location: 'Courtyard', speed: 1.1, direction: 'north', predictedDestination: 'Admin Wing', expectedVelocityRange: { min: 1.8, max: 2.4 } },
        zone: { id: 'admin-wing', name: 'Admin Wing', thermalOccupancyCount: 0, radarMotionDetected: false, badgeOccupancyCount: 0, pathClear: true, adjacentZonesAccessible: true, fireExitsAccessible: true, escapeRoutesAvailable: true, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'admin-wing', pathIsClear: true, adjacentRoutesAvailable: true, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 84, measuredVelocity: 1.2, predictedDestination: 'Admin Wing' },
          { id: 'CAM-2', seesThreat: false, confidence: 80, measuredVelocity: 1.1, predictedDestination: 'Front Lawn' },
        ],
        occupancySystem: { badgeReaderAgrees: true, thermalAgrees: true, radarAgrees: false, emergencyButtonActivated: false, buttonLocation: 'None', buttonTimestamp: new Date('2026-09-07T14:24:30Z') },
        plan: threatPlan('admin-wing', 'Admin Wing safe isolation zone'),
      };
    case 'fire':
      return {
        thermal: { confidence: 100, heatSignature: 100 },
        radar: { confidence: 100, speed: 0.2, movementDetected: true, direction: 'south' },
        video: { confidence: 100, threatType: 'fire', identified: true, location: 'Science Block', predictedDestination: 'Oval Assembly', cameraCount: 4 },
        threat: { id: 'TH-006', type: 'fire', location: 'Science Block', speed: 0.2, direction: 'south', predictedDestination: 'Oval Assembly', expectedVelocityRange: { min: 0, max: 1 } },
        zone: { id: 'campus-wide', name: 'Campus', thermalOccupancyCount: 0, radarMotionDetected: false, badgeOccupancyCount: 0, pathClear: true, adjacentZonesAccessible: true, fireExitsAccessible: true, escapeRoutesAvailable: true, fireLawCompliant: true, emergencyLightsFunctional: true },
        threatPath: { targetZoneId: 'campus-wide', pathIsClear: true, adjacentRoutesAvailable: true, fireExitsRemainAccessible: true },
        cameras: [
          { id: 'CAM-1', seesThreat: true, confidence: 100, measuredVelocity: 0.2, predictedDestination: 'Oval Assembly' },
          { id: 'CAM-2', seesThreat: true, confidence: 100, measuredVelocity: 0.2, predictedDestination: 'Oval Assembly' },
          { id: 'CAM-3', seesThreat: true, confidence: 100, measuredVelocity: 0.2, predictedDestination: 'Oval Assembly' },
          { id: 'CAM-4', seesThreat: true, confidence: 100, measuredVelocity: 0.2, predictedDestination: 'Oval Assembly' },
        ],
        occupancySystem: { badgeReaderAgrees: true, thermalAgrees: true, radarAgrees: true, emergencyButtonActivated: true, buttonLocation: 'Science Block pull station', buttonTimestamp: new Date('2026-09-07T14:25:00Z') },
        plan: firePlan(),
      };
  }
}

export function createConfidenceScenario(kind: ScenarioKind): ConfidenceScenario {
  const { thermal, radar, video, threat, zone, threatPath, cameras, occupancySystem, plan } = buildInputs(kind) as {
    thermal: { confidence: number; heatSignature: number };
    radar: { confidence: number; speed: number; movementDetected: boolean; direction: string };
    video: { confidence: number; threatType: string; identified: boolean; location: string; predictedDestination: string; cameraCount: number };
    threat: ThreatDetection;
    zone: Zone;
    threatPath: ThreatPath;
    cameras: CameraFeed[];
    occupancySystem: OccupancySystem;
    plan: RecommendationPlan;
  };
  const sensorFusion = calculate_sensor_fusion_confidence(thermal, radar, video);
  const occupancy = verify_occupancy_independent(zone, threatPath);
  const historical = analyze_historical_patterns(threat, incidents);
  const secondary = perform_secondary_verification(threat, cameras, occupancySystem);
  const safety = verify_safety_constraints(
    zone,
    plan.gates.filter((gate) => gate.instruction === 'LOCK'),
  );
  const finalConfidence = calculate_final_confidence(
    sensorFusion,
    occupancy,
    historical,
    secondary,
    safety,
  );

  return {
    kind,
    threat,
    plan,
    sensorFusion,
    occupancy,
    historical,
    secondary,
    safety,
    finalConfidence,
    escalation: determine_escalation_decision(finalConfidence, plan),
  };
}
