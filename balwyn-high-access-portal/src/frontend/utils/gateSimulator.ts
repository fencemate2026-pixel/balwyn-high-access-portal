import type { GateStatus } from "../../shared/types.ts";
import { createSeedGates } from "../../shared/mockData.ts";

const STATUSES: GateStatus["status"][] = ["open", "locked", "issue", "moving"];

export function createInitialGates(): GateStatus[] {
  return createSeedGates().map((gate) => ({ ...gate }));
}

export function simulateGateTick(gates: GateStatus[]): GateStatus[] {
  return gates.map((gate, index) => {
    const status = STATUSES[(Math.floor(Date.now() / 12000) + index) % STATUSES.length];
    const openPercent = status === "open" ? 100 : status === "locked" ? 0 : status === "moving" ? 40 + ((index * 13 + new Date().getSeconds()) % 35) : 5;

    return {
      ...gate,
      status,
      openPercent,
      issue: status === "issue" ? gate.issue ?? "Controller heartbeat drift" : undefined,
      lastHeartbeat: new Date().toISOString(),
      cameraOnline: status !== "issue",
    };
  });
}

export function subscribeToGateSimulation(
  onTick: (gates: GateStatus[]) => void,
  seed: GateStatus[] = createInitialGates(),
): () => void {
  let gates = seed;
  onTick(gates);
  const timer = window.setInterval(() => {
    gates = simulateGateTick(gates);
    onTick(gates);
  }, 8000);

  return () => window.clearInterval(timer);
}
