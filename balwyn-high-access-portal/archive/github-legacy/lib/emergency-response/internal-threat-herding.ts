import type { ThreatDetection } from "@/lib/emergency-response/threat-location-strategy";

export interface HerdingStrategy {
  gates_to_lock: string[];
  gates_to_keep_open: string[];
  threat_destination: string;
}

export interface HerdingDependencies {
  lock_gate: (gate: string, reason: string) => Promise<void>;
  unlock_gate: (gate: string, reason: string) => Promise<void>;
  broadcast_personalized_evacuation_routes: (
    strategy: HerdingStrategy,
  ) => Promise<void>;
}

const noopAsync = async () => {};

const defaultDependencies: HerdingDependencies = {
  lock_gate: noopAsync,
  unlock_gate: noopAsync,
  broadcast_personalized_evacuation_routes: noopAsync,
};

export function calculate_herding_strategy(
  threat: ThreatDetection,
): HerdingStrategy {
  const destination = threat.current_location.includes("GYM")
    ? "GYM_CONTAINMENT"
    : "HALLWAY_CONTAINMENT";

  return {
    gates_to_lock:
      destination === "GYM_CONTAINMENT"
        ? ["GYM_NORTH_GATE", "GYM_EAST_GATE", "GYM_SOUTH_GATE"]
        : ["HALL_A", "HALL_B", "HALL_C"],
    gates_to_keep_open:
      destination === "GYM_CONTAINMENT" ? ["EXIT_WEST", "EXIT_SOUTH"] : ["EXIT_NORTH", "EXIT_EAST"],
    threat_destination: destination,
  };
}

export async function execute_intelligent_herding(
  threat: ThreatDetection,
  dependencies: Partial<HerdingDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...dependencies };
  const herding_strategy = calculate_herding_strategy(threat);

  for (const gate of herding_strategy.gates_to_lock) {
    await deps.lock_gate(gate, "HERDING - Block threat escape");
  }

  for (const exitRoute of herding_strategy.gates_to_keep_open) {
    await deps.unlock_gate(exitRoute, "EVACUATION - Kids can exit");
  }

  await deps.broadcast_personalized_evacuation_routes(herding_strategy);
  return herding_strategy;
}
