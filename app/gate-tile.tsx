"use client";

import { useEffect, useRef, useState } from "react";
import type { Gate, GateVisualState } from "@/lib/portal-model";
import type { GateScene } from "./gate-scene";

function stateText(position: GateVisualState) {
  if (position === "closed") return { state: "Stop", detail: "Confirmed closed" };
  if (position === "open") return { state: "Operating", detail: "Confirmed open" };
  if (position === "moving") return { state: "Operating", detail: "Moving, keep clear" };
  if (position === "inactive") return { state: "Inactive", detail: "Not in service" };
  return { state: "Issue", detail: "Status unknown" };
}
export function formatGateTileAriaLabel(gateName: string, position: GateVisualState) {
  const status = stateText(position);
  return `${gateName}: ${status.state}, ${status.detail}`;
}

export default function GateTile({ gate, position, ariaLabel }: { gate: Gate; position: GateVisualState; ariaLabel?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const scene = useRef<GateScene | null>(null);
  const latest = useRef(position);
  const [ready, setReady] = useState(false);
  useEffect(() => { latest.current = position; scene.current?.update(position); }, [position]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let started = false;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      scene.current?.setVisible(visible);
      if (!visible || started) return;
      started = true;
      void import("./gate-scene").then(({ createGateScene }) => {
        if (disposed) return;
        scene.current = createGateScene(element, gate.kind, latest.current, () => setReady(false));
        setReady(true);
      }).catch(() => { /* Local artwork remains visible when WebGL is unavailable. */ });
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => { disposed = true; observer.disconnect(); scene.current?.dispose(); scene.current = null; };
  }, [gate.kind]);
  const tone = position === "inactive" ? "off" : position === "closed" ? "stop" : position === "open" || position === "moving" ? "run" : "issue";
  return <span className={`gate-tile gate-model access-icon gate-state-${tone} is-${position} ${gate.kind}${ready ? " is-rendered" : ""}`} role="img" aria-label={ariaLabel ?? formatGateTileAriaLabel(gate.name, position)}>
    <span className="gate-model-fallback" aria-hidden="true"><img src={`/gates/${gate.kind === "boom" ? "boom" : gate.kind}-blue.webp`} alt="" /><span>Hardware illustration · {stateText(position).detail}</span></span>
    <span className="gate-model-canvas" ref={host} aria-hidden="true" />
  </span>;
}
