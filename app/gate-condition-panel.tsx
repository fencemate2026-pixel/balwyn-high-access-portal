"use client";

import { Activity, ArrowUpRight, DoorOpen, ShieldCheck, Thermometer, Radio } from "lucide-react";
import GateTile from "./gate-tile";
import type { Gate, GateRuntime, GateVisualState, SystemMode } from "@/lib/portal-model";

type Tone = "green" | "amber" | "red";
export function controllerHealth(runtime: GateRuntime | undefined, position: GateVisualState, now: number): { tone: Tone; label: string } {
  if (!runtime?.commissioned) return { tone: "amber", label: "Not commissioned" };
  const lastSeen = runtime.lastSeen ? Date.parse(runtime.lastSeen) : NaN;
  if (!Number.isFinite(lastSeen) || now - lastSeen > 90_000 || runtime.controllerState === "offline") return { tone: "red", label: "Controller offline" };
  if (runtime.controllerState === "fault" || runtime.safetyOk === false || ["failed", "blocked"].includes(runtime.lastCommandState)) return { tone: "red", label: "Attention required" };
  if (position === "unknown" || runtime.safetyOk !== true) return { tone: "amber", label: "Awaiting feedback" };
  return { tone: "green", label: "Controller online" };
}

export default function GateConditionPanel({ gates, runtime, getPosition, now, temperatureC = {}, onSelect }: {
  gates: Gate[]; runtime: Record<string, GateRuntime | undefined>; getPosition: (gate: Gate) => GateVisualState;
  systemMode: SystemMode; now: number; temperatureC?: Record<string, number | undefined>; onSelect?: (gate: Gate) => void;
}) {
  return <section className="gate-condition mb-6" aria-label="Gate condition">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><p className="mb-1 text-[10px] font-semibold tracking-[.18em] text-muted-foreground uppercase">Access infrastructure</p><h2 className="m-0 text-lg text-foreground">Active gate controls</h2></div>
      <span className="flex items-center gap-2 text-xs text-muted-foreground"><Radio className="size-3.5" /> {gates.length} installed access points</span>
    </div>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {gates.map((gate, index) => {
        const run = runtime[gate.id];
        const position = getPosition(gate);
        const health = controllerHealth(run, position, now);
        const time = run?.lastSeen ? Date.parse(run.lastSeen) : NaN;
        const age = Number.isFinite(time) ? Math.max(0, Math.round((now - time) / 1000)) : null;
        const temp = temperatureC[gate.id];
        const hasTemperature = typeof temp === "number" && Number.isFinite(temp);
        return <article key={gate.id} className="hardware-card group overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-xs text-muted-foreground">0{index + 1}</span><div><h3 className="m-0 text-sm font-semibold text-foreground">{gate.name}</h3><p className="m-0 mt-1 text-[11px] text-muted-foreground">{gate.id} <span className="px-1.5">/</span> {gate.type}</p></div></div>
            <span className={`telemetry-badge tone-${health.tone}`}><i className="signal-dot" />{health.label}</span>
          </header>
          <div className="hardware-stage relative mx-3 mt-2">
            <GateTile gate={gate} position={position} />
            <span className="absolute top-3 left-3 flex items-center gap-1.5 text-[9px] tracking-[.13em] text-muted-foreground uppercase"><span className="size-1 rounded-full bg-accent-blue" /> 3D hardware view</span>
            <span className={`position-caption tone-${position === "open" ? "green" : position === "closed" ? "blue" : "amber"}`}><DoorOpen className="size-3.5" />{position === "open" ? "Confirmed open" : position === "closed" ? "Confirmed closed" : position === "moving" ? "Moving · keep clear" : "Position unconfirmed"}</span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-y border-border bg-background/40 py-4">
            <div className="metric-block px-4"><span><Thermometer /> Temperature</span><strong>{hasTemperature ? temp.toFixed(1) : "—"}{hasTemperature && <small>°C</small>}</strong><p>{hasTemperature ? "Controller sensor" : "No sensor fitted"}</p></div>
            <div className="metric-block px-4"><span><Activity /> Heartbeat</span><strong>{age === null ? "—" : age > 3600 ? ">1h" : age}<small>{age !== null && age <= 3600 ? "s" : ""}</small></strong><p><i className={`signal-dot tone-${age !== null && age <= 90 ? "green" : "amber"}`} />{age === null ? "Awaiting heartbeat" : age <= 90 ? "Since last report" : "Stale feedback"}</p></div>
            <div className="metric-block px-4"><span><ShieldCheck /> Safety input</span><strong className="!text-base !leading-8">{run?.safetyOk === false ? "Blocked" : health.tone === "green" && run?.safetyOk === true ? "Healthy" : "Pending"}</strong><p>{health.tone === "green" ? "Verified circuit" : "No current confirmation"}</p></div>
          </div>
          <footer className="flex items-center justify-between gap-3 px-5 py-4"><span className="text-[11px] text-muted-foreground">{!run?.commissioned ? "Ready for onsite commissioning" : "Position follows physical feedback"}</span><button type="button" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-accent-blue/25 bg-accent-blue/10 px-3 py-2 text-xs font-medium text-accent-blue transition hover:border-accent-blue/60 hover:bg-accent-blue/20 focus-visible:outline-2 focus-visible:outline-accent-blue" onClick={() => onSelect?.(gate)}>Gate controls <ArrowUpRight className="size-3.5" /></button></footer>
        </article>;
      })}
    </div>
  </section>;
}
