export type GroupKey = "sports" | "staff" | "front";
export type ViewKey =
  | "dashboard"
  | "gates"
  | "evacuation"
  | "schedule"
  | "automation"
  | "access"
  | "activity"
  | "settings";
export type GatePosition = "open" | "closed";
export type SystemMode = "normal" | "lockdown" | "fire";
export type ModuleKey =
  | "mobile"
  | "video"
  | "visitor"
  | "intercom"
  | "api"
  | "reporting";
export type DayKey =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";
export type PerimeterGateState = "normal" | "armed" | "deployed" | "reset";
export type DetectionKind = "firearm" | "knife" | "smoke" | "flame";
export type AlertDecision = "confirmed" | "rejected" | "uncertain";
export type DetectionStatus = "pending" | "reviewed";

export type Gate = {
  id: string;
  name: string;
  area: string;
  type: string;
  group: GroupKey;
  defaultPosition: GatePosition;
  forceGate?: boolean;
};

export type DayPlan = { enabled: boolean; open: string; close: string };
export type WeekPlan = Record<DayKey, DayPlan>;

export type ActivityRecord = {
  id: number;
  action: string;
  detail: string;
  time: string;
  timestamp: string;
  source?: string;
};

export type AutomationRule = {
  id: number;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
};

export type DetectionEvent = {
  id: string;
  type: DetectionKind;
  source: string;
  confidence: number;
  incidentLocation: string;
  camera: string;
  snapshotLabel: string;
  timestamp: string;
  status: DetectionStatus;
  operatorDecision?: AlertDecision;
  notes?: string;
};

export type AlertVerification = {
  id: string;
  detectionEventId: string;
  operator: string;
  decision: AlertDecision;
  notes: string;
  timestamp: string;
  actionTaken: "none" | "lockdown" | "fire" | "perimeter-deploy";
};

export type SystemEventRecord = {
  id: string;
  category: "mode" | "routing" | "detection" | "perimeter";
  mode: SystemMode;
  detail: string;
  timestamp: string;
};

export type SentinelNodeKind = "classroom" | "junction" | "exit";

export type SentinelNode = {
  id: string;
  label: string;
  kind: SentinelNodeKind;
};

export type SentinelEdge = {
  from: string;
  to: string;
  blocked?: boolean;
};

export type FloorPlan = {
  id: string;
  name: string;
  nodes: SentinelNode[];
  edges: SentinelEdge[];
};

export type ExitAssessment = {
  exitId: string;
  label: string;
  status: "safe" | "blocked";
  reason: string;
};

export type EvacuationRoute = {
  classroomId: string;
  classroom: string;
  exitId: string | null;
  exitLabel: string;
  path: string[];
  advisory: string;
  status: "safe" | "blocked";
};

export type RoutePlan = {
  incidentLocation: string;
  generatedAt: string;
  advisoryOnly: true;
  humanReviewed: boolean;
  routes: EvacuationRoute[];
  exits: ExitAssessment[];
};

export type PersistedPortalState = {
  systemMode: SystemMode;
  gateOverrides: Record<string, GatePosition>;
  perimeterStates: Record<string, PerimeterGateState>;
  schedules: Record<string, WeekPlan>;
  automations: AutomationRule[];
  activity: ActivityRecord[];
  detectionEvents: DetectionEvent[];
  alertVerifications: AlertVerification[];
  systemEvents: SystemEventRecord[];
};
