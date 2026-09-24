"use client";

// Gate condition panel — top of the dashboard.
//
// One glance: the large SYSTEM LED is red, amber or green, and each active gate
// has its own LED plus gauges. Every value comes from the live portal snapshot.
// Nothing is estimated:
//   - Temperature: no temperature sensor is fitted to any gate controller yet,
//     so the gauge reads "No sensor" and the needle is parked. When a controller
//     starts reporting a temperature, pass it in `temperatureC` and it shows.
//   - Heartbeat: seconds since the gate's controller last reported (90 s limit,
//     after which the portal treats the controller as offline).
//   - Position: only a confirmed open/closed from the controller's inputs.

import GateTile from "./gate-tile";
import type { Gate, GateRuntime, GateVisualState, SystemMode } from "@/lib/portal-model";

type Led = "green" | "amber" | "red";

const HEARTBEAT_LIMIT_S = 90;

function gateLed(runtime: GateRuntime | undefined, position: GateVisualState, now: number): { led: Led; reason: string } {
  if (!runtime || !runtime.commissioned) return { led: "amber", reason: "Not commissioned" };
  const age = runtime.lastSeen ? (now - Date.parse(runtime.lastSeen)) / 1000 : Infinity;
  if (runtime.controllerState === "offline" || age > HEARTBEAT_LIMIT_S) return { led: "red", reason: "Controller offline" };
  if (runtime.safetyOk === false) return { led: "red", reason: "Safety input not healthy" };
  if (runtime.lastCommandState === "failed" && runtime.lastError) return { led: "red", reason: "Last command failed" };
  if (position === "unknown") return { led: "amber", reason: "Position not confirmed" };
  return { led: "green", reason: position === "moving" ? "Moving" : `Confirmed ${position}` };
}

function systemLed(mode: SystemMode, leds: Led[]): { led: Led; title: string; detail: string } {
  if (mode === "fire") return { led: "red", title: "Fire evacuation active", detail: "Emergency priority is set" };
  if (leds.includes("red")) return { led: "red", title: "Fault", detail: "A gate needs attention now" };
  if (leds.includes("amber")) return { led: "amber", title: "Attention", detail: "Commissioning or position not confirmed" };
  return { led: "green", title: "All gates healthy", detail: "Controllers online, positions confirmed" };
}

/** Semicircular dial. `fraction` 0..1, or null for "no reading" (needle parked, dial greyed). */
function Gauge({ label, value, unit, fraction, tone }: { label: string; value: string; unit?: string; fraction: number | null; tone: Led | "none" }) {
  const clamped = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  const angle = -90 + clamped * 180; // -90 = left end, +90 = right end
  return (
    <figure className={`gc-gauge tone-${tone}${fraction === null ? " is-empty" : ""}`}>
      <svg viewBox="0 0 120 72" aria-hidden="true">
        <defs>
          <linearGradient id="gc-bezel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4f6f9" /><stop offset="1" stopColor="#aeb8c6" />
          </linearGradient>
          <linearGradient id="gc-scale" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2ee05a" /><stop offset=".6" stopColor="#ffab1a" /><stop offset="1" stopColor="#ff3b2f" />
          </linearGradient>
        </defs>
        <path d="M8 64 A52 52 0 0 1 112 64" fill="none" stroke="url(#gc-bezel)" strokeWidth="14" />
        <path d="M14 64 A46 46 0 0 1 106 64" fill="none" stroke={fraction === null ? "#c3cad5" : "url(#gc-scale)"} strokeWidth="7" />
        {fraction !== null && (
          <g transform={`rotate(${angle} 60 64)`}>
            <path d="M60 22 L63 64 L57 64 Z" fill="#14223a" />
          </g>
        )}
        <circle cx="60" cy="64" r="6" fill="#14223a" stroke="#ffffff" strokeWidth="1.5" />
      </svg>
      <figcaption>
        <strong>{value}{unit && <small> {unit}</small>}</strong>
        <span>{label}</span>
      </figcaption>
    </figure>
  );
}

export default function GateConditionPanel({ gates, runtime, getPosition, systemMode, now, temperatureC = {} }: {
  gates: Gate[];
  runtime: Record<string, GateRuntime | undefined>;
  getPosition: (gate: Gate) => GateVisualState;
  systemMode: SystemMode;
  now: number;
  /** Controller-reported temperature per gate id. Empty until a sensor is fitted. */
  temperatureC?: Record<string, number | undefined>;
}) {
  const rows = gates.map((gate) => {
    const run = runtime[gate.id];
    const position = getPosition(gate);
    const status = gateLed(run, position, now);
    const age = run?.lastSeen ? Math.max(0, Math.round((now - Date.parse(run.lastSeen)) / 1000)) : null;
    return { gate, run, position, status, age, temp: temperatureC[gate.id] };
  });
  const system = systemLed(systemMode, rows.map((row) => row.status.led));

  return (
    <section className="gate-condition" aria-label="Gate condition">
      <div className={`gc-system led-${system.led}`}>
        <span className="gc-led gc-led-lg" aria-hidden="true"><i /></span>
        <div>
          <span className="gc-eyebrow">System</span>
          <strong>{system.title}</strong>
          <small>{system.detail}</small>
        </div>
      </div>
      {rows.map(({ gate, run, position, status, age, temp }) => (
        <article key={gate.id} className={`gc-gate led-${status.led}`}>
          <div className="gc-gate-art"><GateTile gate={gate} position={position} /></div>
          <div className="gc-gate-body">
            <header>
              <span className="gc-led" aria-hidden="true"><i /></span>
              <div>
                <strong>{gate.name}</strong>
                <small>{gate.id} · {status.reason}</small>
              </div>
            </header>
            <div className="gc-gauges">
              <Gauge
                label={temp === undefined ? "Temperature · not fitted" : "Controller temperature"}
                value={temp === undefined ? "No sensor" : temp.toFixed(1)}
                unit={temp === undefined ? undefined : "°C"}
                fraction={temp === undefined ? null : temp / 80}
                tone={temp === undefined ? "none" : temp >= 60 ? "red" : temp >= 45 ? "amber" : "green"}
              />
              <Gauge
                label={age === null ? "Heartbeat · none yet" : "Since last heartbeat"}
                value={age === null ? "None" : String(age)}
                unit={age === null ? undefined : "s"}
                fraction={age === null ? null : age / HEARTBEAT_LIMIT_S}
                tone={age === null ? "none" : age > HEARTBEAT_LIMIT_S ? "red" : age > 30 ? "amber" : "green"}
              />
              <Gauge
                label="Confirmed position"
                value={position === "open" ? "Open" : position === "closed" ? "Closed" : position === "moving" ? "Moving" : "Unknown"}
                fraction={position === "closed" ? 0 : position === "open" ? 1 : position === "moving" ? 0.5 : null}
                tone={position === "unknown" ? "none" : position === "moving" ? "amber" : "green"}
              />
            </div>
            {run?.commissioned === false && <p className="gc-note">Readings start once this gate is commissioned and its controller reports.</p>}
          </div>
        </article>
      ))}
    </section>
  );
}
