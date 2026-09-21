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
  if (position === "open") return "run";
  return "issue";
}

function Defs({ id, k }: { id: string; k: LampKey }) {
  const c = COL[k];
  return (
    <defs>
      <radialGradient id={`l${id}`} cx="35%" cy="30%" r="75%">
        <stop offset="0" stopColor={c.hi} />
        <stop offset=".45" stopColor={c.c} />
        <stop offset="1" stopColor={c.lo} />
      </radialGradient>
      <filter id={`b${id}`} x="-300%" y="-300%" width="700%" height="700%">
        <feGaussianBlur stdDeviation="4.5" />
      </filter>
      <filter id={`s${id}`} x="-20%" y="-50%" width="140%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <linearGradient id={`cab${id}`} x1="0" x2="1">
        <stop offset="0" stopColor="#3a4049" />
        <stop offset=".55" stopColor="#565d67" />
        <stop offset=".56" stopColor="#9aa1aa" />
        <stop offset="1" stopColor="#b6bcc4" />
      </linearGradient>
      <linearGradient id={`cap${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c4c9cf" />
        <stop offset="1" stopColor="#8c939c" />
      </linearGradient>
      <linearGradient id={`hub${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d3d7dc" />
        <stop offset=".6" stopColor="#a7adb5" />
        <stop offset="1" stopColor="#7d848d" />
      </linearGradient>
      <linearGradient id={`pole${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e0e3e7" />
        <stop offset=".45" stopColor="#aab0b8" />
        <stop offset="1" stopColor="#6f767f" />
      </linearGradient>
      <linearGradient id={`st${id}`} x1="0" x2="1">
        <stop offset="0" stopColor="#eef1f4" />
        <stop offset=".5" stopColor="#c7ccd2" />
        <stop offset="1" stopColor="#9ea5ad" />
      </linearGradient>
      <linearGradient id={`bar${id}`} x1="0" x2="1">
        <stop offset="0" stopColor="#9aa1a9" />
        <stop offset=".45" stopColor="#e7eaee" />
        <stop offset="1" stopColor="#8d949c" />
      </linearGradient>
    </defs>
  );
}

function Lamp({ id, k, x, y, r, pill }: { id: string; k: LampKey; x: number; y: number; r: number; pill?: boolean }) {
  const c = COL[k];
  if (pill) {
    return (
      <g className="gate-tile-lamp">
        <rect x={x - r * 2.4} y={y - r * 1.3} width={r * 4.8} height={r * 2.6} rx={r * 1.3} fill={c.g} filter={`url(#b${id})`} />
        <rect x={x - r * 2} y={y - r * 0.8} width={r * 4} height={r * 1.6} rx={r * 0.8} fill={`url(#l${id})`} />
        <rect x={x - r * 1.4} y={y - r * 0.55} width={r * 1.8} height={r * 0.45} rx={r * 0.22} fill="#fff" opacity=".75" />
      </g>
    );
  }
  return (
    <g className="gate-tile-lamp">
      <circle cx={x} cy={y} r={r * 2} fill={c.g} filter={`url(#b${id})`} />
      <circle cx={x} cy={y} r={r * 1.25} fill="#2a2f35" />
      <circle cx={x} cy={y} r={r} fill={`url(#l${id})`} />
      <ellipse cx={x - r * 0.35} cy={y - r * 0.4} rx={r * 0.38} ry={r * 0.26} fill="#fff" opacity=".85" />
    </g>
  );
}

export default function GateTile({ gate, position }: { gate: Gate; position: GateVisualState }) {
  const k = lampKey(position);
  const id = gate.id.replace(/[^a-zA-Z0-9]/g, "");
  const open = position === "open";
  const className = `gate-tile access-icon is-${position} ${gate.kind} ${open ? "is-open" : position === "closed" ? "is-closed" : "is-issue"}`;

  if (gate.kind === "boom") {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <Defs id={id} k={k} />
          <ellipse cx="148" cy="176" rx="40" ry="7" fill="#000" opacity=".4" filter={`url(#s${id})`} />
          <rect x="126" y="54" width="42" height="120" rx="4" fill={`url(#cab${id})`} />
          <line x1="137" y1="58" x2="137" y2="172" stroke="#2b3037" strokeWidth="1" />
          <rect x="123" y="47" width="22" height="9" rx="2" fill={`url(#cap${id})`} />
          <rect x="146" y="49" width="25" height="9" rx="2" fill={`url(#cap${id})`} />
          <g className="gate-tile-arm" style={{ transformOrigin: "150px 104px", transform: open ? "rotate(80deg)" : undefined }}>
            <rect x="54" y="99" width="100" height="11" rx="5.5" fill={`url(#pole${id})`} />
            <rect x="54" y="99.5" width="100" height="3" rx="1.5" fill="#fff" opacity=".4" />
            <ellipse cx="56" cy="104.5" rx="4" ry="5.5" fill="#6d747c" />
            <Lamp id={id} k={k} x={76} y={104.5} r={3.6} pill />
          </g>
          <rect x="140" y="88" width="36" height="32" rx="8" fill={`url(#hub${id})`} />
          <rect x="140" y="88" width="36" height="6" rx="3" fill="#fff" opacity=".3" />
          <Lamp id={id} k={k} x={164} y={104} r={4.6} />
        </svg>
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 200 200">
        <Defs id={id} k={k} />
        <ellipse cx="100" cy="177" rx="72" ry="6" fill="#000" opacity=".35" filter={`url(#s${id})`} />
        <rect x="46" y="40" width="14" height="136" rx="2" fill={`url(#st${id})`} stroke="#5c636b" strokeWidth=".8" />
        <rect x="44" y="30" width="18" height="11" rx="3" fill="#2f353c" />
        <Lamp id={id} k={k} x={53} y={35.5} r={4.2} />
        <rect x="59" y="58" width="5" height="10" rx="1" fill="#8e959d" />
        <rect x="59" y="146" width="5" height="10" rx="1" fill="#8e959d" />
        <g className="gate-tile-leaf" style={{ transformOrigin: "63px 106px", transform: open ? "skewY(-10deg) scaleX(.32)" : undefined }}>
          <rect x="63" y="50" width="100" height="112" rx="2" fill="none" stroke={`url(#st${id})`} strokeWidth="7" />
          <rect x="63" y="50" width="100" height="112" rx="2" fill="none" stroke="#5c636b" strokeWidth=".8" />
          <g fill={`url(#bar${id})`} stroke="#6b727a" strokeWidth=".5">
            {[81, 96, 111, 126, 141].map((x) => <rect key={x} x={x} y="53" width="4.2" height="106" />)}
          </g>
          <rect x="66" y="84" width="13" height="28" rx="2" fill="#dfe3e7" stroke="#5c636b" strokeWidth=".8" />
          <rect x="68.5" y="87" width="8" height="10" rx="1" fill="#1e2329" />
          <Lamp id={id} k={k} x={72.5} y={104} r={3.2} />
        </g>
      </svg>
    </span>
  );
}
