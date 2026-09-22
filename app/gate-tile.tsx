"use client";

import type { Gate, GateVisualState } from "@/lib/portal-model";

function gateStateText(position: GateVisualState) {
  if (position === "closed") return { state: "Stop", detail: "Confirmed closed" };
  if (position === "open") return { state: "Operating", detail: "Confirmed open" };
  if (position === "moving") return { state: "Operating", detail: "Moving, keep clear" };
  if (position === "inactive") return { state: "Inactive", detail: "Not in service" };
  return { state: "Issue", detail: "Status unknown" };
}

export function formatGateTileAriaLabel(gateName: string, position: GateVisualState) {
  const status = gateStateText(position);
  return `${gateName}: ${status.state}, ${status.detail}`;
}

function lampKey(position: GateVisualState) {
  if (position === "closed") return "stop";
  if (position === "open" || position === "moving") return "run";
  return "issue";
}

export default function GateTile({ gate, position, ariaLabel }: { gate: Gate; position: GateVisualState; ariaLabel?: string }) {
  const k = lampKey(position);
  const moving = position === "moving";
  const className = `tile gate-tile access-icon gate-state-${k}${moving ? " is-moving" : ""} is-${position} ${gate.kind}`;
  const label = ariaLabel ?? formatGateTileAriaLabel(gate.name, position);
  const src = gate.kind === "boom" ? "/ops/boom-gate.jpg" : "/ops/swing-gate.jpg";
  return (
    <span className={className} role="img" aria-label={label}>
      <span className="stage">
        <img src={src} alt="" />
      </span>
    </span>
  );
}
