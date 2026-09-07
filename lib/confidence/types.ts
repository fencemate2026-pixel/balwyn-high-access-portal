export const layerThresholds = {
  sensorFusion: 98,
  occupancy: 95,
  historical: 90,
  secondary: 95,
  safety: 100,
} as const;

export interface ThermalDetection {
  confidence: number;
  heatSignature: number;
  occupancyCount?: number;
}

export interface RadarDetection {
  confidence: number;
  speed: number;
  movementDetected: boolean;
  occupancyMotionDetected?: boolean;
  direction?: string;
}

export interface VideoDetection {
  confidence: number;
  threatType: string;
  identified: boolean;
  location: string;
  predictedDestination: string;
  cameraCount?: number;
}

export interface ThreatDetection {
  id: string;
  type: string;
  location: string;
  speed: number;
  direction: string;
  predictedDestination: string;
  expectedVelocityRange?: { min: number; max: number };
}

export interface IncidentRecord {
  id: string;
  threatType: string;
  location: string;
  speed: number;
  direction: string;
  predictedDestination: string;
  recommendedAction: string;
  result: 'successful' | 'failed';
  escapeRoutes?: string[];
}

export interface Zone {
  id: string;
  name: string;
  thermalOccupancyCount: number;
  radarMotionDetected: boolean;
  badgeOccupancyCount: number;
  pathClear: boolean;
  adjacentZonesAccessible: boolean;
  fireExitsAccessible: boolean;
  escapeRoutesAvailable: boolean;
  fireLawCompliant: boolean;
  emergencyLightsFunctional: boolean;
}

export interface ThreatPath {
  targetZoneId: string;
  pathIsClear: boolean;
  adjacentRoutesAvailable: boolean;
  fireExitsRemainAccessible: boolean;
}

export interface CameraFeed {
  id: string;
  seesThreat: boolean;
  confidence: number;
  measuredVelocity: number;
  predictedDestination: string;
}

export interface OccupancySystem {
  badgeReaderAgrees: boolean;
  thermalAgrees: boolean;
  radarAgrees: boolean;
  emergencyButtonActivated: boolean;
  buttonLocation: string;
  buttonTimestamp: Date;
}

export interface GateDirective {
  gateId: string;
  instruction: 'LOCK' | 'KEEP_OPEN' | 'OPEN';
  reason: string;
}

export interface ClassroomRoute {
  room: string;
  route: string;
  destination: string;
}

export interface RecommendationPlan {
  responseType: 'threat_containment' | 'fire_evacuation';
  targetZoneId: string;
  targetZoneName: string;
  recommendedAction: string;
  gates: GateDirective[];
  classroomRoutes: ClassroomRoute[];
  rationale: string;
}

export type OperatorDecision =
  | 'PENDING'
  | 'APPROVED'
  | 'ESCALATED'
  | 'CANCELLED'
  | 'CONFIRM_LOCKDOWN'
  | 'INVESTIGATE_FURTHER';

export function clampScore(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function roundScore(value: number) {
  return Math.round(clampScore(value) * 10) / 10;
}

export function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
