import type { AccessRule, AIInsight, DashboardSnapshot, HireBooking, PortalSnapshot, ScheduleRule, WeatherSnapshot } from "./types.ts";
import { DEFAULT_OPERATOR } from "./constants.ts";

export function createSeedGates() {
  return [
    {
      id: "gate-north",
      name: "North Entry Vehicle Gate",
      zone: "North Entry",
      status: "open",
      automationMode: "scheduled",
      relayChannel: 1,
      openPercent: 100,
      lastHeartbeat: new Date().toISOString(),
      cameraOnline: true,
    },
    {
      id: "gate-admin",
      name: "Admin Forecourt Bollards",
      zone: "Admin Forecourt",
      status: "locked",
      automationMode: "ai-assisted",
      relayChannel: 2,
      openPercent: 0,
      lastHeartbeat: new Date().toISOString(),
      cameraOnline: true,
    },
    {
      id: "gate-sports",
      name: "Sports Precinct Roller Gate",
      zone: "Sports Precinct",
      status: "moving",
      automationMode: "scheduled",
      relayChannel: 3,
      openPercent: 46,
      lastHeartbeat: new Date().toISOString(),
      cameraOnline: true,
    },
    {
      id: "gate-service",
      name: "Service Lane Access Gate",
      zone: "Service Lane",
      status: "issue",
      automationMode: "manual",
      relayChannel: 4,
      openPercent: 8,
      lastHeartbeat: new Date().toISOString(),
      issue: "Photo-eye obstruction detected",
      cameraOnline: false,
    },
  ] as const;
}

export function createWeatherSnapshot(step = 0): WeatherSnapshot {
  const sequence: WeatherSnapshot[] = [
    { mode: "clear", temperatureC: 18, windKph: 9, humidity: 52, rainChance: 8, summary: "Clear approach with excellent camera visibility.", updatedAt: new Date().toISOString() },
    { mode: "cloudy", temperatureC: 16, windKph: 14, humidity: 61, rainChance: 26, summary: "Cloud band approaching from the west.", updatedAt: new Date().toISOString() },
    { mode: "rain", temperatureC: 14, windKph: 18, humidity: 79, rainChance: 72, summary: "Rain active across service lane and oval entries.", updatedAt: new Date().toISOString() },
    { mode: "storm", temperatureC: 13, windKph: 31, humidity: 88, rainChance: 92, summary: "Storm watch: increase lock verification and CCTV monitoring.", updatedAt: new Date().toISOString() },
  ];
  const base = sequence[step % sequence.length];
  return { ...base, updatedAt: new Date().toISOString() };
}

export function createFallbackSnapshot(): PortalSnapshot {
  const gates = createSeedGates().map((gate) => ({ ...gate }));
  const recentEvents: DashboardSnapshot["recentEvents"] = [
    { id: "evt-1", title: "Perimeter audit", detail: "North entry authenticated and auto-open validated.", severity: "info", occurredAt: new Date().toISOString() },
    { id: "evt-2", title: "Obstacle alert", detail: "Service lane beam interruption requires operator review.", severity: "warning", occurredAt: new Date().toISOString() },
  ];

  const accessRules: AccessRule[] = [
    { id: "rule-admin", name: "Staff daylight access", zone: "Admin Forecourt", credentialGroup: "Teaching + Admin", schedule: "Mon-Fri 06:30-18:30", threatLevelLimit: "Normal", enabled: true, notes: "Auto-open when credential and ANPR match." },
    { id: "rule-hire", name: "After-hours hire perimeter", zone: "Sports Precinct", credentialGroup: "Facility Hire Hosts", schedule: "Bookings only", threatLevelLimit: "Elevated", enabled: true, notes: "Requires escort notification after 21:00." },
  ];

  const schedules: ScheduleRule[] = [
    { id: "sched-1", name: "Morning ingress", gateId: "gate-north", opensAt: "06:45", closesAt: "08:45", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], action: "open", enabled: true, source: "scheduled" },
    { id: "sched-2", name: "Evening sports hire lock", gateId: "gate-sports", opensAt: "21:10", closesAt: "21:20", days: ["Mon", "Wed", "Fri"], action: "lock", enabled: true, source: "ai-assisted" },
  ];

  const insights: AIInsight[] = [
    { id: "ai-1", title: "Balance open dwell time", summary: "North entry remains open 14% longer than comparable weekday baselines.", priority: "medium", recommendation: "Reduce open dwell by 7 seconds after the morning rush.", confidence: 0.83, affectedGateIds: ["gate-north"] },
    { id: "ai-2", title: "Weather lockdown rehearsal", summary: "Storm probability exceeds 90% after 15:00 with high pedestrian risk.", priority: "high", recommendation: "Stage an amber pre-lock procedure and notify sports precinct supervisors.", confidence: 0.91, affectedGateIds: ["gate-sports", "gate-service"] },
  ];

  const hireBookings: HireBooking[] = [
    { id: "hire-1", organisation: "Balwyn Netball Association", contactName: "Renee Jackson", location: "Sports Precinct", startIso: new Date(Date.now() + 86_400_000).toISOString(), endIso: new Date(Date.now() + 90_000_000).toISOString(), expectedAttendance: 120, status: "approved" },
  ];

  return {
    gates,
    dashboard: {
      activeGates: gates.length,
      openGates: gates.filter((gate) => gate.status === "open").length,
      alerts: gates.filter((gate) => gate.status === "issue").length,
      scheduledActionsToday: schedules.length + 3,
      aiSuggestions: insights.length,
      weatherRisk: "Moderate",
      uptimePercent: 99.98,
      recentEvents,
    },
    accessRules,
    schedules,
    insights,
    weather: createWeatherSnapshot(0),
    emergency: { mode: "normal", lockdownActive: false, fireAlarmActive: false, musterPoint: "Western oval assembly", triggeredBy: DEFAULT_OPERATOR, updatedAt: new Date().toISOString() },
    hireBookings,
  };
}
