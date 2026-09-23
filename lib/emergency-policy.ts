import type { GatePosition } from "./portal-model";

// Emergency commands this site offers.
//
// Site decision (23 Sep 2026): Balwyn High has NO lockdown function. Fire
// evacuation is the only emergency command, and it only ever asks active gates
// to OPEN. This is enforced here, on the server, so removing the dashboard
// button is not the only protection: a hand-crafted API request for lockdown
// is refused with the same message.
//
// The certified fire panel remains the life-safety authority. A portal fire
// command is a convenience that queues open commands; it is not a fire release.

export class EmergencyCommandError extends Error {}

export function resolveEmergencyCommand(mode: unknown): { mode: "fire"; position: GatePosition } {
  const requested = String(mode ?? "");
  if (requested === "lockdown") throw new EmergencyCommandError("Lockdown is not available on this site.");
  if (requested !== "fire") throw new EmergencyCommandError("Invalid emergency command.");
  return { mode: "fire", position: "open" };
}
