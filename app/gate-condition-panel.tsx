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

/**
 * Speedometer dial in the style of the supplied Freepik gauge set: four coloured
 * segments (red, orange, lime, green) with white gaps, white outer rim, tick
 * marks, a two-tone needle and a white hub carrying the value.
 * `fraction` 0..1 positions the needle; null = no reading (segments greyed,
 * no needle), so an empty dial can never be mistaken for a real value.
 * `reverse` puts green on the left (for values where low is good).
 */
const SEGMENTS = ["#d9190c", "#f39200", "#84c600", "#00b32c"];
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0, y0] = p(a0); const [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function Gauge({ label, value, unit, fraction, reverse = false }: { label: string; value: string; unit?: string; fraction: number | null; reverse?: boolean }) {
  const empty = fraction === null;
  const f = empty ? 0 : Math.max(0, Math.min(1, fraction));
  const colours = reverse ? [...SEGMENTS].reverse() : SEGMENTS;
  const cx = 100, cy = 100;
  // 180° dial split into four segments with small white gaps.
  const gap = 0.035;
  const segs = [0, 1, 2, 3].map((i) => {
    const start = Math.PI - (i * Math.PI) / 4 - (i === 0 ? 0 : gap / 2);
    const end = Math.PI - ((i + 1) * Math.PI) / 4 + (i === 3 ? 0 : gap / 2);
    return { d: arc(cx, cy, 70, start, end), colour: empty ? "#9aa1ab" : colours[i] };
  });
  const angle = Math.PI - f * Math.PI;
  const tip = [cx + 80 * Math.cos(angle), cy - 80 * Math.sin(angle)];
  const baseA = [cx + 7 * Math.cos(angle + Math.PI / 2), cy - 7 * Math.sin(angle + Math.PI / 2)];
  const baseB = [cx + 7 * Math.cos(angle - Math.PI / 2), cy - 7 * Math.sin(angle - Math.PI / 2)];
  const ticks = Array.from({ length: 21 }, (_, i) => {
    const t = Math.PI - (i * Math.PI) / 20; const long = i % 5 === 0;
    const r0 = long ? 44 : 48, r1 = 54;
    return <line key={i} x1={cx + r0 * Math.cos(t)} y1={cy - r0 * Math.sin(t)} x2={cx + r1 * Math.cos(t)} y2={cy - r1 * Math.sin(t)} stroke="#ffffff" strokeWidth={long ? 2.4 : 1.3} strokeLinecap="round" opacity={empty ? 0.6 : 0.95} />;
  });
  return (
    <figure className={`gc-gauge${empty ? " is-empty" : ""}`}>
      <svg viewBox="0 0 200 132" role="img" aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
        <defs>
          <filter id="gc-shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".35" /></filter>
          <linearGradient id="gc-needle-l" x1="0" x2="1"><stop offset="0" stopColor="#6d7178" /><stop offset="1" stopColor="#8e939b" /></linearGradient>
          <radialGradient id="gc-hub" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d7dbe0" /></radialGradient>
        </defs>
        {/* white outer rim */}
        <path d={arc(cx, cy, 90, Math.PI, 0)} fill="none" stroke="#ffffff" strokeWidth="4" filter="url(#gc-shadow)" />
        {segs.map((seg, i) => <path key={i} d={seg.d} fill="none" stroke={seg.colour} strokeWidth="26" filter="url(#gc-shadow)" />)}
        {/* sheen across the top half of the segments */}
        <path d={arc(cx, cy, 78, Math.PI, 0)} fill="none" stroke="#ffffff" strokeWidth="6" opacity=".18" />
        {ticks}
        {!empty && (
          <g filter="url(#gc-shadow)">
            <path d={`M${baseA[0]} ${baseA[1]} L${tip[0]} ${tip[1]} L${cx} ${cy} Z`} fill="#6d7178" />
            <path d={`M${baseB[0]} ${baseB[1]} L${tip[0]} ${tip[1]} L${cx} ${cy} Z`} fill="url(#gc-needle-l)" />
          </g>
        )}
        <circle cx={cx} cy={cy} r="11" fill="url(#gc-hub)" stroke="#9aa1ab" strokeWidth="1" filter="url(#gc-shadow)" />
        <rect x={cx - 38} y={cy + 8} width="76" height="22" fill="#ffffff" stroke="#c9d0d8" filter="url(#gc-shadow)" />
        <text x={cx} y={cy + 24} textAnchor="middle" className="gc-gauge-value">{value}{unit ? ` ${unit}` : ""}</text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/**
 * Position shown on the real OPEN / CLOSED signs (public/signs/, cut from the
 * supplied sign set). Only a confirmed position lights a sign; with no
 * confirmed position both signs stay dimmed.
 */
function PositionSigns({ position }: { position: GateVisualState }) {
  const open = position === "open" || position === "moving";
  const closed = position === "closed";
  const caption = position === "open" ? "Confirmed open" : position === "closed" ? "Confirmed closed" : position === "moving" ? "Moving" : "No confirmed position";
  return (
    <figure className="gc-signs" aria-label={`Position: ${caption}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed local artwork */}
      <img src="/signs/sign-open.png" alt="" aria-hidden="true" className={open ? "is-lit" : "is-dim"} />
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed local artwork */}
      <img src="/signs/sign-closed.png" alt="" aria-hidden="true" className={closed ? "is-lit" : "is-dim"} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** Real lamp artwork (public/leds/*.png, cut from the supplied LED button set). */
function Lamp({ led, size = "md" }: { led: Led | "off"; size?: "md" | "lg" }) {
  // eslint-disable-next-line @next/next/no-img-element -- fixed local artwork
  return <img className={`gc-lamp gc-lamp-${size} is-${led}`} src={`/leds/led-${led}.png`} alt="" aria-hidden="true" draggable={false} />;
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
        <Lamp led={system.led} size="lg" />
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
              <Lamp led={status.led} />
              <div>
                <strong>{gate.name}</strong>
                <small>{gate.id} · {status.reason}</small>
              </div>
            </header>
            <div className="gc-gauges">
              <Gauge
                reverse
                label={temp === undefined ? "Temperature · not fitted" : "Controller temperature"}
                value={temp === undefined ? "No sensor" : temp.toFixed(1)}
                unit={temp === undefined ? undefined : "°C"}
                fraction={temp === undefined ? null : temp / 80}
              />
              <Gauge
                reverse
                label={age === null ? "Heartbeat · none yet" : "Since last heartbeat"}
                value={age === null ? "None" : String(age)}
                unit={age === null ? undefined : "s"}
                fraction={age === null ? null : age / HEARTBEAT_LIMIT_S}
              />
              <PositionSigns position={position} />
            </div>
            {run?.commissioned === false && <p className="gc-note">Readings start once this gate is commissioned and its controller reports.</p>}
          </div>
        </article>
      ))}
    </section>
  );
}
