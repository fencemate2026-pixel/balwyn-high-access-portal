"use client";

import { useState } from "react";
import { MousePointer2, RotateCcw } from "lucide-react";
import GateTile from "./gate-tile";
import type { Gate, GatePosition } from "@/lib/portal-model";

const TYPE: Record<Gate["kind"], string> = {
  "single-swing": "Swing gate",
  "double-swing": "Double swing gate",
  sliding: "Sliding gate",
  boom: "Boom gate",
};

/** Picture of one gate. OPEN and CLOSE move the model. They do not pulse a unit. */
export default function OperableGate({ name, kind, area, livePulse = false }: { name: string; kind: Gate["kind"]; area: string; livePulse?: boolean }) {
  const [picture, setPicture] = useState<GatePosition>("closed");
  const gate: Gate = {
    id: `${kind}-picture`,
    name,
    area,
    type: TYPE[kind],
    kind,
    active: true,
    group: "front",
    defaultPosition: "closed",
  };
  const pictureLabel = picture === "open"
    ? "Open picture. This is not a position sensor."
    : "Closed picture. This is not a position sensor.";
  return (
    <article className="hardware-card group mb-4 overflow-hidden rounded-2xl border">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="m-0 text-sm font-semibold">{name}</h3>
          <p className="m-0 mt-1 text-[11px]">{TYPE[kind]}</p>
        </div>
      </header>
      <div className="hardware-stage relative mx-3 mt-2">
        <span className="hardware-view-label"><span className="size-1.5 rounded-full bg-[#5CC8FF]" /> 3D hardware view</span>
        <GateTile
          gate={gate}
          position={picture}
          motion={{ target: picture, label: pictureLabel }}
          interactive
          ariaLabel={`${name} ${picture} picture. OPEN and CLOSE move this picture. They do not pulse the unit.`}
        />
        <div className="quick-gate-controls" aria-label={`${name} picture controls`}>
          <button type="button" className={`quick-state-button quick-open ${picture === "open" ? "is-current" : ""}`} aria-label={`Show ${name} open`} onClick={() => setPicture("open")}><span>OPEN</span></button>
          <button type="button" className={`quick-state-button quick-closed ${picture === "closed" ? "is-current" : ""}`} aria-label={`Show ${name} closed`} onClick={() => setPicture("closed")}><span>CLOSE</span></button>
        </div>
        <aside className={`gate-current-state state-${picture}`}>
          <small>CURRENT STATE</small>
          <strong><i aria-hidden="true" /><span>{picture === "open" ? "OPEN PICTURE" : "CLOSED PICTURE"}</span></strong>
          <span>Position</span><b>{pictureLabel}</b>
        </aside>
        <div className="orbit-help"><span><MousePointer2 aria-hidden="true" /> Drag to rotate</span><span>Wheel to zoom</span><span><RotateCcw aria-hidden="true" /> Double-click reset</span></div>
      </div>
      <footer className="px-5 py-4 text-[11px]">
        {livePulse
          ? "OPEN and CLOSE move this picture. The Open button queues one pulse on the live unit. That pulse does not close the gate."
          : "OPEN and CLOSE move this picture. They do not pulse the unit."}
      </footer>
    </article>
  );
}
