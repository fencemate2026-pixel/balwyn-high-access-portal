import type { PerimeterThreatDetection } from "@/lib/early-detection/perimeter-threat-detector";
import { ALL_17_GATES, INTERNAL_ESCAPE_ROUTES } from "@/lib/emergency-response/threat-location-strategy";

interface OccupancyState {
  total_people: number;
}

interface BroadcastMessage {
  mode: string;
  title: string;
  content: string;
  priority: "CRITICAL" | "HIGH" | "NORMAL";
  audio: boolean;
  projectors: boolean;
  intercom: boolean;
}

interface PoliceAlert {
  threat_type: "ARMED" | "INTRUDER";
  threat_location: string;
  threat_status: "OUTSIDE_PERIMETER";
  estimated_police_response: string;
  students_status: "EVACUATING";
  gates_status: "ALL_LOCKED";
}

export interface PerimeterLockdownDependencies {
  lock_gate: (gate: string, reason: string) => Promise<void>;
  unlock_gate: (gate: string, reason: string) => Promise<void>;
  log_gate_operation: (operation: "LOCK" | "UNLOCK", gate: string, detail: string) => void;
  delay: (ms: number) => Promise<void>;
  broadcast_to_all_rooms: (message: BroadcastMessage) => Promise<void>;
  get_current_occupancy: () => OccupancyState;
  alert_police: (alert: PoliceAlert) => Promise<void>;
  monitor_perimeter_until_all_clear: () => void;
}

const noopAsync = async () => {};

const defaultDependencies: PerimeterLockdownDependencies = {
  lock_gate: noopAsync,
  unlock_gate: noopAsync,
  log_gate_operation: () => {},
  delay: async () => {},
  broadcast_to_all_rooms: noopAsync,
  get_current_occupancy: () => ({ total_people: 0 }),
  alert_police: noopAsync,
  monitor_perimeter_until_all_clear: () => {},
};

export class PerimeterLockdownSystem {
  private readonly deps: PerimeterLockdownDependencies;

  constructor(dependencies: Partial<PerimeterLockdownDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...dependencies };
  }

  async execute_perimeter_lockdown(
    operator_approval: boolean,
    threat: Pick<PerimeterThreatDetection, "gate_approach" | "time_to_gate_contact" | "weapon_identified">,
  ) {
    if (!operator_approval) {
      return {
        approved: false,
        lockedGatesCount: 0,
        unlockedEvacuationRoutesCount: 0,
        finalOccupancy: this.deps.get_current_occupancy(),
      };
    }

    const startTime = Date.now();

    for (const gate of ALL_17_GATES) {
      await this.deps.lock_gate(gate, "PERIMETER_LOCKDOWN - Keep threat OUTSIDE");
      this.deps.log_gate_operation("LOCK", gate, "Perimeter lockdown");
      await this.deps.delay(50);
    }

    for (const exitRoute of INTERNAL_ESCAPE_ROUTES) {
      await this.deps.unlock_gate(exitRoute, "EVACUATION - Let kids OUT");
      this.deps.log_gate_operation("UNLOCK", exitRoute, "Evacuation route");
    }

    await this.deps.broadcast_to_all_rooms({
      mode: "PERIMETER_THREAT",
      title: "THREAT DETECTED OUTSIDE",
      content: "Evacuate immediately via nearest safe exit",
      priority: "CRITICAL",
      audio: true,
      projectors: true,
      intercom: true,
    });

    let occupancy = this.deps.get_current_occupancy();
    let safetyIterations = 0;
    while (occupancy.total_people > 0 && safetyIterations < 600) {
      await this.deps.delay(1000);
      occupancy = this.deps.get_current_occupancy();
      safetyIterations += 1;
    }

    await this.deps.alert_police({
      threat_type: threat.weapon_identified ? "ARMED" : "INTRUDER",
      threat_location: `${threat.gate_approach} gate`,
      threat_status: "OUTSIDE_PERIMETER",
      estimated_police_response: "6 minutes",
      students_status: "EVACUATING",
      gates_status: "ALL_LOCKED",
    });

    this.deps.monitor_perimeter_until_all_clear();

    return {
      approved: true,
      lockedGatesCount: ALL_17_GATES.length,
      unlockedEvacuationRoutesCount: INTERNAL_ESCAPE_ROUTES.length,
      finalOccupancy: occupancy,
      timeToGateContact: threat.time_to_gate_contact,
      elapsedMs: Date.now() - startTime,
    };
  }
}
