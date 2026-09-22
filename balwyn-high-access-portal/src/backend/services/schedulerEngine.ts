import type { DashboardSnapshot, GateStatus, ScheduleRule } from "../../shared/types.ts";

export function buildDashboard(gates: GateStatus[], schedules: ScheduleRule[]): DashboardSnapshot {
  return {
    activeGates: gates.length,
    openGates: gates.filter((gate) => gate.status === "open").length,
    alerts: gates.filter((gate) => gate.status === "issue").length,
    scheduledActionsToday: schedules.filter((schedule) => schedule.enabled).length * 2,
    aiSuggestions: gates.filter((gate) => gate.status !== "locked").length,
    weatherRisk: gates.some((gate) => gate.status === "issue") ? "Elevated" : "Low",
    uptimePercent: 99.97,
    recentEvents: [
      {
        id: "dash-1",
        title: "Morning unlock batch ready",
        detail: "Three scheduled unlock actions remain queued for today.",
        severity: "info",
        occurredAt: new Date().toISOString(),
      },
      {
        id: "dash-2",
        title: "Service lane fault follow-up",
        detail: "Safety loop review required before after-hours automation resumes.",
        severity: gates.some((gate) => gate.status === "issue") ? "warning" : "info",
        occurredAt: new Date().toISOString(),
      },
    ],
  };
}

export function nextSchedules(schedules: ScheduleRule[]): ScheduleRule[] {
  return schedules.filter((schedule) => schedule.enabled).sort((left, right) => left.opensAt.localeCompare(right.opensAt));
}
