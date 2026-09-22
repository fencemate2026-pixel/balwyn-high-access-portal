export type GateHealth = "open" | "locked" | "issue" | "moving";
export type AutomationMode = "manual" | "scheduled" | "ai-assisted";
export type WeatherMode = "clear" | "cloudy" | "rain" | "storm";
export type EmergencyMode = "normal" | "lockdown" | "fire";
export type InsightPriority = "low" | "medium" | "high";

export interface GateStatus {
  id: string;
  name: string;
  zone: string;
  status: GateHealth;
  automationMode: AutomationMode;
  relayChannel: number;
  openPercent: number;
  lastHeartbeat: string;
  issue?: string;
  cameraOnline: boolean;
}

export interface DashboardSnapshot {
  activeGates: number;
  openGates: number;
  alerts: number;
  scheduledActionsToday: number;
  aiSuggestions: number;
  weatherRisk: string;
  uptimePercent: number;
  recentEvents: ActivityEvent[];
}

export interface AccessRule {
  id: string;
  name: string;
  zone: string;
  credentialGroup: string;
  schedule: string;
  threatLevelLimit: string;
  enabled: boolean;
  notes: string;
}

export interface ScheduleRule {
  id: string;
  name: string;
  gateId: string;
  opensAt: string;
  closesAt: string;
  days: string[];
  action: "open" | "lock";
  enabled: boolean;
  source: AutomationMode;
}

export interface AIInsight {
  id: string;
  title: string;
  summary: string;
  priority: InsightPriority;
  recommendation: string;
  confidence: number;
  affectedGateIds: string[];
}

export interface WeatherSnapshot {
  mode: WeatherMode;
  temperatureC: number;
  windKph: number;
  humidity: number;
  rainChance: number;
  summary: string;
  updatedAt: string;
}

export interface EmergencyState {
  mode: EmergencyMode;
  lockdownActive: boolean;
  fireAlarmActive: boolean;
  musterPoint: string;
  triggeredBy: string;
  updatedAt: string;
}

export interface HireBooking {
  id: string;
  organisation: string;
  contactName: string;
  location: string;
  startIso: string;
  endIso: string;
  expectedAttendance: number;
  status: "pending" | "approved" | "declined";
}

export interface ActivityEvent {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  occurredAt: string;
}

export interface AccessDecision {
  granted: boolean;
  reason: string;
  recommendedGateAction: "none" | "open" | "lock";
}

export interface HardwareCommand {
  gateId: string;
  command: "open" | "lock" | "hold" | "reset";
  relayChannel: number;
  checksum: string;
  createdAt: string;
}

export interface PortalSnapshot {
  gates: GateStatus[];
  dashboard: DashboardSnapshot;
  accessRules: AccessRule[];
  schedules: ScheduleRule[];
  insights: AIInsight[];
  weather: WeatherSnapshot;
  emergency: EmergencyState;
  hireBookings: HireBooking[];
}
