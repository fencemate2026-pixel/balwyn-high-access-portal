"use client";

import type { Gate, GateVisualState } from "@/lib/portal-model";

const COL = {
  stop: { hi: "#ffd0c8", c: "#ff3b2f", lo: "#8c0d05", g: "rgba(255,59,47,.9)" },
  run: { hi: "#d4ffe0", c: "#2ee05a", lo: "#077a27", g: "rgba(46,224,90,.9)" },
  issue: { hi: "#fff0cc", c: "#ffab1a", lo: "#9a5800", g: "rgba(255,171,26,.95)" },
} as const;

type LampKey = keyof typeof COL;

function lampKey(position: GateVisualState): LampKey {
  if (position === "closed") return "stop";
  if (position === "open" || position === "moving") return "run";
  return "issue";
}

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

// Gate tiles use the approved gate and boom artwork (public/gates/*.jpg).
// The lamps drawn over the artwork are the only state indicators: they sit
// exactly over the beacon positions in each image, so the picture never shows
// a colour the live data has not confirmed.
//   red   = confirmed closed        green = confirmed open / moving (flashing)
//   amber = no confirmed position   grey  = inactive gate (artwork greyed)
const ART = {
  swing: { src: "/gates/pedestrian-gate.jpg", ratio: "480 / 640", lamps: [{ x: 13, y: 7, size: 7 }, { x: 25, y: 32.5, size: 5 }] },
  boom: { src: "/gates/boom-gate.jpg", ratio: "600 / 528", lamps: [{ x: 90, y: 25.5, size: 6 }, { x: 14.8, y: 43, size: 5 }] },
} as const;

export default function GateTile({ gate, position, ariaLabel }: { gate: Gate; position: GateVisualState; ariaLabel?: string }) {
  const k = lampKey(position);
  const moving = position === "moving";
  const inactive = position === "inactive";
  const art = gate.kind === "boom" ? ART.boom : ART.swing;
  const className = `tile gate-tile gate-photo access-icon gate-state-${k}${moving ? " is-moving" : ""} is-${position} ${gate.kind}`;
  const label = ariaLabel ?? formatGateTileAriaLabel(gate.name, position);
  return (
    <span className={className} role="img" aria-label={label}>
      <span className="stage">
        {/* The frame keeps the artwork's own proportions so each lamp stays on its beacon. */}
        <span className="gate-photo-frame" style={{ aspectRatio: art.ratio }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed local artwork */}
          <img className="gate-photo-art" src={art.src} alt="" aria-hidden="true" draggable={false} />
          {art.lamps.map((lamp, index) => (
            <span
              key={index}
              aria-hidden="true"
              className={`gate-photo-lamp lamp-${inactive ? "off" : k}`}
              style={{ left: `${lamp.x}%`, top: `${lamp.y}%`, width: `${lamp.size}%` }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}
