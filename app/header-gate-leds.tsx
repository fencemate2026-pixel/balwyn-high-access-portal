"use client";

/**
 * Top-bar gate lights (24 Oct 2026, Jarrod: "up the very top of the page there
 * needs to be something that tells you which gates are open or closed with an LED
 * signal or something bright, so when you're going through other pages you can
 * see what's open or closed").
 *
 * One bright light per active gate, in the header that stays on every page.
 * Pressing a light opens that gate's panel.
 *
 * Truthfulness: the colour comes only from the controller's reported position
 * (via gateVisualState), never from a command that was merely requested:
 *   OPEN     green, pulsing   reed-confirmed open
 *   CLOSED   red, steady      reed-confirmed closed
 *   MOVING   amber, fast      the controller reports travel, or a command is in flight
 *   OFFLINE  grey             controller not online, not commissioned or no recent report
 *   CHECK    amber, steady    online but the position is not confirmed (failed command, reed fault)
 *   PAUSED   grey             position monitoring is switched off in settings
 */
import type { Gate, GateRuntime, GateVisualState } from "@/lib/portal-model";

export type HeaderGateLight = "open" | "closed" | "moving" | "offline" | "check" | "paused";

const LABEL: Record<HeaderGateLight, string> = {
  open: "Open", closed: "Closed", moving: "Moving", offline: "Offline", check: "Check", paused: "Paused",
};

/** How long without a report before a controller counts as offline (matches gateVisualState). */
const STALE_MS = 90_000;

/** Pure: the light for one gate. Exported for tests. */
export function headerGateLight(visual: GateVisualState, runtime: GateRuntime | undefined, monitoring: boolean, now = Date.now()): HeaderGateLight {
  if (!monitoring) return "paused";
  if (visual === "open") return "open";
  if (visual === "closed") return "closed";
  const lastSeen = runtime?.lastSeen ? Date.parse(runtime.lastSeen) : NaN;
  if (!runtime?.commissioned || runtime.controllerState !== "online" || !Number.isFinite(lastSeen) || now - lastSeen > STALE_MS) return "offline";
  if (runtime.reportedPosition === "moving" || ["queued", "dispatched"].includes(runtime.lastCommandState)) return "moving";
  return "check";
}

export function HeaderGateLeds({ gates, lightFor, onSelect }: {
  gates: Gate[];
  lightFor: (gate: Gate) => HeaderGateLight;
  onSelect: (gate: Gate) => void;
}) {
  if (!gates.length) return null;
  return <div className="header-gate-leds" role="group" aria-label="Gate positions">
    {gates.map((gate) => {
      const light = lightFor(gate);
      return <button key={gate.id} type="button" className={`header-gate-led is-${light}`} title={`${gate.name}: ${LABEL[light]}`} aria-label={`${gate.name}: ${LABEL[light]}. Open gate panel.`} onClick={() => onSelect(gate)}>
        <i aria-hidden="true" />
        <span className="header-gate-led-name">{gate.name}</span>
        <span className="header-gate-led-id">{gate.id}</span>
        <strong>{LABEL[light]}</strong>
      </button>;
    })}
  </div>;
}
