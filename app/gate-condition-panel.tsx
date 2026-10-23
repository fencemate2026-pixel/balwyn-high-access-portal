"use client";

import { Activity, ArrowUpRight, ShieldCheck, Thermometer, Radio, MousePointer2, RotateCcw } from "lucide-react";
import GateTile from "./gate-tile";
import { GateServiceStrip } from "./gate-service-panel";
import { gateMotion } from "@/lib/gate-motion";
import { controllerCanRelease, controllerResponsive, type Gate, type GateRuntime, type GateServiceInfo, type GateVisualState, type SystemMode } from "@/lib/portal-model";

type Tone = "green" | "amber" | "red";
export function controllerHealth(runtime: GateRuntime | undefined, position: GateVisualState, now: number): { tone: Tone; label: string } {
  if (!runtime?.commissioned) return { tone: "amber", label: "Not commissioned" };
  const lastSeen = runtime.lastSeen ? Date.parse(runtime.lastSeen) : NaN;
  if (!Number.isFinite(lastSeen) || now - lastSeen > 90_000 || runtime.controllerState === "offline") return { tone: "red", label: "Controller offline" };
  if (runtime.controllerState === "fault" || runtime.safetyOk === false) return { tone: "red", label: "Attention required" };
  // A command that did not complete is reported on its own (audit 24 Oct 2026, UI-01). Before, it turned the
  // card red as if the controller or safety input had failed, and stayed that way after healthy heartbeats.
  if (["failed", "blocked"].includes(runtime.lastCommandState)) return { tone: "amber", label: "Last command not completed" };
  if (position === "unknown" || runtime.safetyOk !== true) return { tone: "amber", label: "Awaiting feedback" };
  return { tone: "green", label: "Controller online" };
}

export default function GateConditionPanel({ gates, runtime, getPosition, systemMode, monitoring = true, now, temperatureC = {}, canOperate = false, busy = false, service, onSelect, onCommand }: {
  gates: Gate[]; runtime: Record<string, GateRuntime | undefined>; getPosition: (gate: Gate) => GateVisualState;
  systemMode: SystemMode; monitoring?: boolean; now: number; temperatureC?: Record<string, number | undefined>;
  canOperate?: boolean; busy?: boolean;
  /** Cycle counter per gate (snapshot.service); null/undefined = counting not active yet. */
  service?: Record<string, GateServiceInfo> | null;
  onSelect?: (gate: Gate) => void; onCommand?: (gate: Gate, position: "open" | "closed") => void;
}) {
  return <section className="gate-condition mb-6" aria-label="Gate condition">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><p className="mb-1 text-[10px] font-semibold tracking-[.18em] text-muted-foreground uppercase">Access infrastructure</p><h2 className="m-0 text-lg text-foreground">Active gate controls</h2></div>
      <span className="flex items-center gap-2 text-xs text-muted-foreground"><Radio className="size-3.5" /> {gates.length} installed access points</span>
    </div>
    <div className="gate-condition-grid">
      {gates.map((gate, index) => {
        const run = runtime[gate.id];
        const position = getPosition(gate);
        const health = controllerHealth(run, position, now);
        const motion = gateMotion(gate, run, monitoring, now);
        const time = run?.lastSeen ? Date.parse(run.lastSeen) : NaN;
        const age = Number.isFinite(time) ? Math.max(0, Math.round((now - time) / 1000)) : null;
        const temp = temperatureC[gate.id];
        const hasTemperature = typeof temp === "number" && Number.isFinite(temp);
        const commandInFlight = ["queued", "dispatched"].includes(run?.lastCommandState ?? "idle");
        const canCommand = Boolean(onCommand && canOperate && systemMode === "normal" && controllerResponsive(run, now) && run?.safetyOk === true && !commandInFlight && !busy);
        // The safety reading is shown from the safety data alone (fresh heartbeat + healthy input), not from the
        // card's overall tone, which a queued command or an unfinished one also changes (UI-01).
        const safetyCurrent = age !== null && age <= 90 && run?.controllerState !== "offline" && run?.safetyOk === true;
        const canRelease = Boolean(onCommand && canOperate && systemMode === "normal" && controllerCanRelease(run, now) && !commandInFlight && !busy);
        return <article key={gate.id} className="hardware-card group overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div className="flex items-center gap-3"><span className="gate-ordinal grid size-9 place-items-center rounded-none border border-[#FF7A00] bg-[#FF7A00] text-xs font-bold text-white" aria-hidden="true">0{index + 1}</span><div><h3 className="m-0 text-sm font-semibold text-foreground">{gate.name}</h3><p className="m-0 mt-1 text-[11px] text-muted-foreground">{gate.id} <span className="px-1.5">/</span> {gate.type}</p></div></div>
            <span className={`telemetry-badge tone-${health.tone}`}><i className="signal-dot" />{health.label}</span>
          </header>
          <div className="hardware-stage relative mx-3 mt-2">
            <GateTile gate={gate} position={position} motion={motion} interactive />
            <span className="hardware-view-label"><span className="size-1.5 rounded-full bg-accent-blue" /> 3D hardware view</span>
            <div className="quick-gate-controls" aria-label={`${gate.name} quick controls`}>
              <button type="button" className={`quick-state-button quick-open ${position === "open" ? "is-current" : ""}`} disabled={!canCommand} aria-label={`Review open command for ${gate.name}`} onClick={() => onCommand?.(gate, "open")}><span>OPEN</span></button>
              <button type="button" className={`quick-state-button quick-closed ${position === "closed" ? "is-current" : ""}`} disabled={!canRelease} aria-label={`Review close command for ${gate.name}`} onClick={() => onCommand?.(gate, "closed")}><span>CLOSE</span></button>
            </div>
            <aside className={`gate-current-state state-${position}`}>
              <small>CURRENT STATE</small>
              <strong><i aria-hidden="true" /><span>{position === "open" ? "OPEN" : position === "closed" ? "CLOSED" : position === "moving" ? "MOVING" : "UNKNOWN"}</span></strong>
              <span>Position</span><b>{motion.label}</b>
              <span>Health</span><b>{health.label}</b>
            </aside>
            <div className="orbit-help"><span><MousePointer2 /> Drag to rotate</span><span>Wheel to zoom</span><span>Right-drag to pan</span><span><RotateCcw /> Double-click reset</span></div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-y border-border bg-background/40 py-4">
            <div className="metric-block px-4"><span><Thermometer /> Pi temperature</span><strong>{hasTemperature ? temp.toFixed(1) : "—"}{hasTemperature && <small>°C</small>}</strong><p>{hasTemperature ? "Pi processor (not air temperature)" : "No reading from the controller"}</p></div>
            <div className="metric-block px-4"><span><Activity /> Heartbeat</span><strong>{age === null ? "—" : age > 3600 ? ">1h" : age}<small>{age !== null && age <= 3600 ? "s" : ""}</small></strong><p><i className={`signal-dot tone-${age !== null && age <= 90 ? "green" : "amber"}`} />{age === null ? "Awaiting heartbeat" : age <= 90 ? "Since last report" : "Stale feedback"}</p></div>
            <div className="metric-block px-4"><span><ShieldCheck /> Safety input</span><strong className="!text-base !leading-8">{run?.safetyOk === false ? "Blocked" : safetyCurrent ? "Healthy" : "Pending"}</strong><p>{safetyCurrent ? "Verified circuit" : "No current confirmation"}</p></div>
          </div>
          <GateServiceStrip gateName={gate.name} info={service?.[gate.id]} />
          <footer className="flex items-center justify-between gap-3 px-5 py-4"><span className="text-[11px] text-muted-foreground">{!run?.commissioned ? "Ready for onsite commissioning" : "Position follows physical feedback"}</span><button type="button" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-accent-blue/25 bg-accent-blue/10 px-3 py-2 text-xs font-medium text-accent-blue transition hover:border-accent-blue/60 hover:bg-accent-blue/20 focus-visible:outline-2 focus-visible:outline-accent-blue" onClick={() => onSelect?.(gate)}>Gate controls <ArrowUpRight className="size-3.5" /></button></footer>
        </article>;
      })}
    </div>
  </section>;
}
