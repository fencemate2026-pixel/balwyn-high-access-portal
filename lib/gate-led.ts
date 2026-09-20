/**
 * Derives a real-world indicator-light state for a gate, door or boom.
 *
 * This is deliberately SEPARATE from gateVisualState(). gateVisualState()
 * collapses everything that is not a confirmed open/closed into "unknown",
 * which is correct for a text label but throws away the two states an
 * operator most needs to see on a light: MOVING and FAULT.
 *
 * The safety rule is preserved unchanged: a green ("open") or red-steady
 * ("closed") light is shown ONLY when the controller has actually reported
 * that position over a fresh heartbeat. Everything else is amber or dark.
 * The light never invents a position.
 */
import type { Gate, GateRuntime } from "./portal-model";

export type LedColour = "green" | "red" | "amber" | "off";
export type LedBehaviour = "steady" | "flash" | "fast-flash" | "breathe";

export type LedState = {
  colour: LedColour;
  behaviour: LedBehaviour;
  /** Short label for the tooltip / screen reader. */
  label: string;
  /** Longer plain-English line for the panel under the light. */
  detail: string;
};

export const STALE_AFTER_MS = 90_000;

export function gateLedState(
  gate: Gate,
  runtime?: GateRuntime,
  monitoring = true,
  now: number = Date.now(),
): LedState {
  if (!gate.active) {
    return { colour: "off", behaviour: "steady", label: "Inactive", detail: "This gate is not in service." };
  }

  if (!monitoring) {
    return { colour: "off", behaviour: "breathe", label: "Monitoring off", detail: "Live monitoring is switched off for this site." };
  }

  if (!runtime || runtime.controllerState === "uncommissioned" || !runtime.commissioned) {
    return { colour: "off", behaviour: "breathe", label: "Not commissioned", detail: "No controller has completed commissioning on this gate yet." };
  }

  if (runtime.controllerState === "fault") {
    return { colour: "red", behaviour: "fast-flash", label: "Fault", detail: "The controller is reporting a fault. Do not rely on the position shown." };
  }

  if (runtime.controllerState === "offline") {
    return { colour: "off", behaviour: "breathe", label: "Offline", detail: "No contact with the controller." };
  }

  const seen = runtime.lastSeen ? Date.parse(runtime.lastSeen) : NaN;
  if (!Number.isFinite(seen) || now - seen > STALE_AFTER_MS) {
    return { colour: "off", behaviour: "breathe", label: "No recent heartbeat", detail: "The last heartbeat is more than 90 seconds old. Position unknown." };
  }

  if (runtime.lastCommandState === "failed" || runtime.lastCommandState === "blocked") {
    return { colour: "red", behaviour: "fast-flash", label: "Command failed", detail: "The last command did not complete. Position unknown." };
  }

  if (runtime.lastCommandState === "queued" || runtime.lastCommandState === "dispatched" || runtime.reportedPosition === "moving") {
    return { colour: "amber", behaviour: "flash", label: "Moving", detail: "The gate is in motion. Keep clear." };
  }

  if (runtime.reportedPosition === "open") {
    return { colour: "green", behaviour: "steady", label: "Open", detail: "Confirmed open." };
  }

  if (runtime.reportedPosition === "closed") {
    return { colour: "red", behaviour: "steady", label: "Closed", detail: "Confirmed closed." };
  }

  return { colour: "amber", behaviour: "flash", label: "Position unknown", detail: "The controller is online but has not reported a confirmed position." };
}
