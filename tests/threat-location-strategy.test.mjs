import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

function create_firearm_threat() {
  return {
    id: "threat-1",
    threat_type: "ARMED_INTRUDER",
    current_location: "OUTSIDE_FRONT_GATE",
  };
}

test("Threat outside -> full perimeter lockdown", async () => {
  const threat = create_firearm_threat();
  const perimeter = {
    threat_location_status: "OUTSIDE_PERIMETER",
    gate_approach: "FRONT",
    time_to_gate_contact: 9,
  };
  const { determine_emergency_strategy } = await vite.ssrLoadModule(
    "/lib/emergency-response/threat-location-strategy.ts",
  );

  const strategy = determine_emergency_strategy(threat, perimeter);
  assert.equal(strategy.strategy, "FULL_PERIMETER_LOCKDOWN_AND_EVACUATE");
  assert.equal(strategy.gates_to_lock.length, 17);
  assert(strategy.gates_to_unlock.length > 0);
  assert(strategy.projector_message.includes("THREAT OUTSIDE"));
});

test("Threat inside -> intelligent herding", async () => {
  const threat = create_firearm_threat();
  threat.current_location = "INSIDE_GYMNASIUM";
  const perimeter = { threat_location_status: "INSIDE_BUILDING" };
  const { determine_emergency_strategy } = await vite.ssrLoadModule(
    "/lib/emergency-response/threat-location-strategy.ts",
  );

  const strategy = determine_emergency_strategy(threat, perimeter);
  assert.equal(
    strategy.strategy,
    "INTELLIGENT_HERDING_AND_TARGETED_EVACUATION",
  );
  assert(strategy.gates_to_lock.length < 17);
  assert(strategy.gates_to_unlock.length > 0);
});

test("Perimeter lockdown executes in < 10 seconds", async () => {
  const threat = {
    gate_approach: "FRONT",
    time_to_gate_contact: 9,
    weapon_identified: true,
  };
  const locked = [];
  let occupancyReads = 0;
  const { PerimeterLockdownSystem } = await vite.ssrLoadModule(
    "/lib/emergency-response/perimeter-lockdown.ts",
  );
  const perimeter_lockdown_system = new PerimeterLockdownSystem({
    lock_gate: async (gate) => {
      locked.push(gate);
    },
    unlock_gate: async () => {},
    log_gate_operation: () => {},
    delay: async () => {},
    broadcast_to_all_rooms: async () => {},
    get_current_occupancy: () => ({
      total_people: occupancyReads++ === 0 ? 20 : 0,
    }),
    alert_police: async () => {},
    monitor_perimeter_until_all_clear: () => {},
  });

  const start = Date.now();
  const result = await perimeter_lockdown_system.execute_perimeter_lockdown(
    true,
    threat,
  );
  const elapsed = Date.now() - start;

  assert(elapsed < 10000);
  assert.equal(result.lockedGatesCount, 17);
  assert.equal(locked.length, 17);
});

test("Evacuation completes with all occupants out", async () => {
  const threat = {
    gate_approach: "FRONT",
    time_to_gate_contact: 4,
    weapon_identified: false,
  };
  let occupancyReads = 0;
  const { PerimeterLockdownSystem } = await vite.ssrLoadModule(
    "/lib/emergency-response/perimeter-lockdown.ts",
  );
  const perimeter_lockdown_system = new PerimeterLockdownSystem({
    lock_gate: async () => {},
    unlock_gate: async () => {},
    log_gate_operation: () => {},
    delay: async () => {},
    broadcast_to_all_rooms: async () => {},
    get_current_occupancy: () => ({
      total_people: occupancyReads++ < 2 ? 5 : 0,
    }),
    alert_police: async () => {},
    monitor_perimeter_until_all_clear: () => {},
  });

  const result = await perimeter_lockdown_system.execute_perimeter_lockdown(
    true,
    threat,
  );
  assert.equal(result.finalOccupancy.total_people, 0);
});
