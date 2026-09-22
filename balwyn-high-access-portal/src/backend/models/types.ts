export type {
  AccessDecision,
  AccessRule,
  ActivityEvent,
  AIInsight,
  DashboardSnapshot,
  EmergencyState,
  GateStatus,
  HardwareCommand,
  HireBooking,
  PortalSnapshot,
  ScheduleRule,
  WeatherSnapshot,
} from "../../shared/types.ts";

export interface OperatorContext {
  id: string;
  role: string;
  name: string;
}
