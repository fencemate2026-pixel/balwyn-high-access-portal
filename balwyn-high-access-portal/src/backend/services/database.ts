import postgres from "postgres";
import type { AccessDecision, AccessRule, EmergencyState, GateStatus, HireBooking, PortalSnapshot, ScheduleRule, WeatherSnapshot } from "../../shared/types.ts";
import { createFallbackSnapshot, createSeedGates, createWeatherSnapshot } from "../../shared/mockData.ts";
import { simulateGateTick } from "../../frontend/utils/gateSimulator.ts";
import { buildInsights } from "./aiEngine.ts";
import { buildDashboard } from "./schedulerEngine.ts";

type SqlClient = ReturnType<typeof postgres>;

interface PortalState {
  gates: GateStatus[];
  accessRules: AccessRule[];
  schedules: ScheduleRule[];
  emergency: EmergencyState;
  hireBookings: HireBooking[];
  weather: WeatherSnapshot;
}

const fallback = createFallbackSnapshot();

class DatabaseService {
  private readonly sql?: SqlClient;
  private state: PortalState = {
    gates: createSeedGates().map((gate) => ({ ...gate })),
    accessRules: fallback.accessRules,
    schedules: fallback.schedules,
    emergency: fallback.emergency,
    hireBookings: fallback.hireBookings,
    weather: createWeatherSnapshot(0),
  };

  constructor() {
    if (process.env.DATABASE_URL) {
      this.sql = postgres(process.env.DATABASE_URL, { max: 5, idle_timeout: 20 });
    }
  }

  async getSnapshot(): Promise<PortalSnapshot> {
    this.state.gates = simulateGateTick(this.state.gates);
    this.state.weather = createWeatherSnapshot(Math.floor(Date.now() / 15000));
    return {
      gates: this.state.gates,
      accessRules: this.state.accessRules,
      schedules: this.state.schedules,
      emergency: this.state.emergency,
      weather: this.state.weather,
      hireBookings: this.state.hireBookings,
      dashboard: buildDashboard(this.state.gates, this.state.schedules),
      insights: buildInsights(this.state.gates, this.state.schedules, this.state.weather),
    };
  }

  async getGates(): Promise<GateStatus[]> {
    return (await this.getSnapshot()).gates;
  }

  async updateGate(gateId: string, action: "open" | "lock"): Promise<GateStatus> {
    this.state.gates = this.state.gates.map((gate) => gate.id === gateId ? {
      ...gate,
      status: action === "open" ? "open" : "locked",
      openPercent: action === "open" ? 100 : 0,
      issue: undefined,
      lastHeartbeat: new Date().toISOString(),
    } : gate);
    const updated = this.state.gates.find((gate) => gate.id === gateId);
    if (!updated) {
      throw new Error(`Unknown gate ${gateId}`);
    }
    return updated;
  }

  async getEmergency(): Promise<EmergencyState> {
    return this.state.emergency;
  }

  async setEmergency(action: "lockdown" | "fire" | "normal", operator: string): Promise<EmergencyState> {
    this.state.emergency = {
      mode: action === "normal" ? "normal" : action,
      lockdownActive: action === "lockdown",
      fireAlarmActive: action === "fire",
      musterPoint: action === "fire" ? "Western oval assembly" : "Southern refuge point",
      triggeredBy: operator,
      updatedAt: new Date().toISOString(),
    };
    if (action === "lockdown") {
      this.state.gates = this.state.gates.map((gate) => ({ ...gate, status: "locked", openPercent: 0 }));
    }
    return this.state.emergency;
  }

  async getRules(): Promise<AccessRule[]> {
    return this.state.accessRules;
  }

  async evaluateAccess(gateId: string, credentialGroup: string): Promise<AccessDecision> {
    const rule = this.state.accessRules.find((entry) => entry.credentialGroup === credentialGroup && entry.enabled);
    if (!rule) {
      return { granted: false, reason: "No enabled policy matches the credential group.", recommendedGateAction: "lock" };
    }
    const gate = this.state.gates.find((entry) => entry.id === gateId);
    if (!gate) {
      return { granted: false, reason: "Unknown gate target.", recommendedGateAction: "none" };
    }
    return {
      granted: gate.status !== "issue",
      reason: gate.status === "issue" ? "Gate is in issue mode and requires manual supervision." : `Policy ${rule.name} permits access.`,
      recommendedGateAction: gate.status === "issue" ? "none" : "open",
    };
  }

  async getSchedules(): Promise<ScheduleRule[]> {
    return this.state.schedules;
  }

  async upsertSchedule(schedule: ScheduleRule): Promise<ScheduleRule> {
    const existing = this.state.schedules.findIndex((entry) => entry.id === schedule.id);
    if (existing >= 0) {
      this.state.schedules[existing] = schedule;
    } else {
      this.state.schedules.push(schedule);
    }
    return schedule;
  }

  async getHireBookings(): Promise<HireBooking[]> {
    return this.state.hireBookings;
  }

  async createHireBooking(booking: HireBooking): Promise<HireBooking> {
    this.state.hireBookings = [...this.state.hireBookings, booking];
    return booking;
  }

  async getSqlHealth(): Promise<{ connected: boolean; schema: string }> {
    if (!this.sql) {
      return { connected: false, schema: "balwyn_portal" };
    }
    await this.sql`select 1`;
    return { connected: true, schema: "balwyn_portal" };
  }
}

export const database = new DatabaseService();
