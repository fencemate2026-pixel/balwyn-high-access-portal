"use client";

import { useEffect, useRef, useState } from "react";
import type { Gate, GateVisualState } from "@/lib/portal-model";
import type { GateMotion } from "@/lib/gate-motion";
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

export default function GateTile({ gate, position, motion, ariaLabel }: { gate: Gate; position: GateVisualState; motion?: GateMotion; ariaLabel?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const scene = useRef<GateScene | null>(null);
  const target = motion?.target ?? (position === "open" || position === "closed" ? position : null);
  const detail = motion?.label ?? stateText(position).detail;
  const latest = useRef({ position, target });
  const [ready, setReady] = useState(false);
  useEffect(() => { latest.current = { position, target }; scene.current?.update(position, target); }, [position, target]);
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
        scene.current = createGateScene(element, gate.kind, latest.current.position, latest.current.target, () => setReady(false));
        setReady(true);
      }).catch(() => { /* Local artwork remains visible when WebGL is unavailable. */ });
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => { disposed = true; observer.disconnect(); scene.current?.dispose(); scene.current = null; };
  }, [gate.kind]);
  const tone = position === "inactive" ? "off" : position === "closed" ? "stop" : position === "open" ? "run" : "issue";
  return <span className={`gate-tile gate-model access-icon gate-state-${tone} is-${position} ${gate.kind}${ready ? " is-rendered" : ""}`} role="img" aria-label={ariaLabel ?? (detail === stateText(position).detail ? formatGateTileAriaLabel(gate.name, position) : `${formatGateTileAriaLabel(gate.name, position)}. ${detail}`)}>
    <span className="gate-model-fallback" aria-hidden="true"><img src={`/gates/${gate.kind === "boom" ? "boom" : gate.kind}-blue.webp`} alt="" /><span>Hardware illustration · {detail}</span></span>
    <span className="gate-model-canvas" ref={host} aria-hidden="true" />
    <span className="gate-led-indicator" aria-hidden="true"><i /><span>{detail}</span></span>
  </span>;
}
