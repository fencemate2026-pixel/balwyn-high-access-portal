export type GroupKey = "sports" | "staff" | "front" | "side";
export type GatePosition = "open" | "closed";
export type ReportedPosition = GatePosition | "moving" | "unknown";
export type SystemMode = "normal" | "lockdown" | "fire";
export type ControllerState = "online" | "offline" | "fault" | "uncommissioned";
export type CommandState = "idle" | "queued" | "dispatched" | "acknowledged" | "failed" | "blocked";
export type ModuleKey = "mobile" | "video" | "visitor" | "intercom" | "api" | "reporting";
export type DayKey = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export type Gate = {
  id: string;
  name: string;
  area: string;
  type: string;
  kind: "single-swing" | "double-swing" | "boom";
  active: boolean;
  group: GroupKey;
  defaultPosition: GatePosition;
};

export type DayPlan = { enabled: boolean; open: string; close: string };
export type WeekPlan = Record<DayKey, DayPlan>;

export type ActivityRecord = {
  id: number;
  action: string;
  detail: string;
  category: string;
  actorName: string;
  createdAt: string;
};

export type AutomationRule = {
  id: number;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
};

export type GateRuntime = {
  gateId: string;
  commandedPosition: GatePosition;
  reportedPosition: ReportedPosition;
  controllerState: ControllerState;
  safetyOk: boolean | null;
  lastSeen: string | null;
  lastCommandState: CommandState;
  lastCommandId: number | null;
  lastError: string | null;
  credentialIssued: boolean;
  commissioned: boolean;
};

export type PortalSettings = {
  positionMonitoring: boolean;
  faultAlerts: boolean;
  voiceAnnouncements: boolean;
  enabledModules: ModuleKey[];
};

export type PortalUser = {
  isOwner?: boolean;
  displayName: string;
  email: string;
  role: "administrator" | "operator" | "viewer";
};

export type PortalPlan = {
  tier: "core" | "advanced";
  name: string;
  advancedFeatures: boolean;
};

export type PortalSnapshot = {
  systemMode: SystemMode;
  gates: GateRuntime[];
  schedules: Record<string, WeekPlan>;
  activity: ActivityRecord[];
  automations: AutomationRule[];
  settings: PortalSettings;
  plan: PortalPlan;
  user: PortalUser;
  serverTime: string;
};

export const DAYS: DayKey[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const GATES: Gate[] = [
  { id: "TF-ENTRY", name: "Tony Frizza Stadium Entry", area: "Tony Frizza Stadium", type: "Single swing gate", kind: "single-swing", active: true, group: "sports", defaultPosition: "closed" },
  { id: "SIDE-ENTRY", name: "Side Entry", area: "Side Entry", type: "Single swing gate", kind: "single-swing", active: true, group: "side", defaultPosition: "closed" },
  { id: "TF-EXIT", name: "Tony Frizza Exit Single Gate", area: "Tony Frizza Stadium", type: "Single swing gate", kind: "single-swing", active: false, group: "sports", defaultPosition: "closed" },
  { id: "OFFICE-ENTRY-DG1", name: "Office Entry 1 Double Swing Gates", area: "Office", type: "Double swing gates", kind: "double-swing", active: false, group: "front", defaultPosition: "closed" },
  { id: "OFFICE-EXIT-DG1", name: "Office Exit 1 Double Swing Gates", area: "Office", type: "Double swing gates", kind: "double-swing", active: false, group: "front", defaultPosition: "closed" },
  { id: "STAFF-ENTRY-DG", name: "Staff Car Park Entry Double Swing Gates", area: "Staff Car Park", type: "Double swing gates", kind: "double-swing", active: false, group: "staff", defaultPosition: "closed" },
  { id: "STAFF-ENTRY-BOOM", name: "Staff Entry Boom Gate", area: "Staff Car Park", type: "Boom gate", kind: "boom", active: false, group: "staff", defaultPosition: "closed" },
  { id: "OFFICE-ENTRY-BOOM1", name: "Office Entry 1 Boom Gate", area: "Office", type: "Boom gate", kind: "boom", active: false, group: "front", defaultPosition: "closed" },
  { id: "OFFICE-EXIT-BOOM1", name: "Office Exit 1 Boom Gate", area: "Office", type: "Boom gate", kind: "boom", active: false, group: "front", defaultPosition: "closed" },
];

export const ACTIVE_GATES = GATES.filter((gate) => gate.active);

export function isGateActive(gateId: string): boolean {
  return ACTIVE_GATES.some((gate) => gate.id === gateId);
}

export type GateVisualState = GatePosition | "unknown" | "inactive";

export function gateVisualState(gate: Gate, runtime?: GateRuntime, monitoring = true): GateVisualState {
  if (!gate.active) return "inactive";
  if (!monitoring || !runtime?.commissioned || runtime.controllerState !== "online") return "unknown";
  if (!runtime.lastSeen || !Number.isFinite(Date.parse(runtime.lastSeen)) || Date.now() - Date.parse(runtime.lastSeen) > 90_000) return "unknown";
  if (["queued", "dispatched", "failed", "blocked"].includes(runtime.lastCommandState)) return "unknown";
  return runtime.reportedPosition === "open" || runtime.reportedPosition === "closed" ? runtime.reportedPosition : "unknown";
}

export function makeWeekPlan(gate: Gate): WeekPlan {
  void gate;
  return Object.fromEntries(DAYS.map((day) => [day, {
    enabled: false,
    open: "",
    close: "",
  }])) as WeekPlan;
}

export function makeSchedules(): Record<string, WeekPlan> {
  return Object.fromEntries(GATES.map((gate) => [gate.id, makeWeekPlan(gate)]));
}

export const INITIAL_AUTOMATIONS: Omit<AutomationRule, "id">[] = [];
