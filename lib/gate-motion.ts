import type { Gate, GatePosition, GateRuntime } from "./portal-model";

export type GateMotion = { target: GatePosition | null; label: string };

/** Command animation is a labelled preview, never physical confirmation. */
export function gateMotion(gate: Gate, runtime?: GateRuntime, monitoring = true, now = Date.now()): GateMotion {
  if (!gate.active) return { target: null, label: "Not in service" };
  const seen = runtime?.lastSeen ? Date.parse(runtime.lastSeen) : NaN;
  if (!monitoring || !runtime?.commissioned || runtime.controllerState !== "online"
    || !Number.isFinite(seen) || now - seen > 90_000) {
    return { target: null, label: "Position unconfirmed" };
  }
  if (["failed", "blocked"].includes(runtime.lastCommandState)) {
    return { target: null, label: "Command stopped · position unconfirmed" };
  }
  const direction = runtime.commandedPosition === "open" ? "Open" : "Close";
  if (["queued", "dispatched"].includes(runtime.lastCommandState)) {
    return { target: runtime.commandedPosition, label: `${direction} command preview · awaiting confirmation` };
  }
  if (runtime.reportedPosition === "moving") {
    return runtime.lastCommandId && runtime.lastCommandState === "acknowledged"
      ? { target: runtime.commandedPosition, label: `${direction === "Open" ? "Opening" : "Closing"} · keep clear` }
      : { target: null, label: "Moving · direction unconfirmed" };
  }
  if (runtime.reportedPosition === "open" || runtime.reportedPosition === "closed") {
    return { target: runtime.reportedPosition, label: `Confirmed ${runtime.reportedPosition}` };
  }
  return { target: null, label: "Position unconfirmed" };
}
