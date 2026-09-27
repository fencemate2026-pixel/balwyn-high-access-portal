// Bright Glass building blocks (25 Sep 2026 design brief).
// Square corners, zero purple, cyan glass edges, #FF7A00 orange for action and "today".
// Exact values from the brief:
//   glass bevel:  bg-[#101622]/35 backdrop-blur-xl border-[rgba(0,240,255,0.22)]
//   gauge centre: bg-[#121722]/80 border-[rgba(255,255,255,0.04)]
//   gauge fill:   text-[#FF7A00] drop-shadow-[0_0_8px_rgba(255,122,0,0.6)]

/** Primary glass panel: bright edge, inner top highlight, inner bottom shade, soft cyan halo. */
export const GLASS_PANEL =
  "mk-glass mk-card rounded-none bg-white border border-[#D8E3EC] shadow-[0_1px_2px_rgba(15,42,68,0.06),0_8px_24px_rgba(15,42,68,0.06)]";

/** Secondary glass tile (calendar days, forecast days). */
export const GLASS_TILE =
  "mk-tile rounded-none bg-[#F7F9FC] border border-[#DCE5EE]";

export const GLASS_FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#0B6BCB] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

/** Small glass button. Primary tone is the orange action. */
export function glassButton(tone: "glass" | "orange" = "glass") {
  const base = `inline-flex h-9 min-w-9 items-center justify-center gap-1.5 px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${GLASS_FOCUS}`;
  return tone === "orange"
    ? `${base} rounded-none border border-[#FF9A3D] bg-[#FF7A00] text-[#0A0E15] shadow-[0_0_14px_rgba(255,122,0,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] enabled:hover:bg-[#FF8F26]`
    : `${base} ${GLASS_TILE} text-[#0F2A44] enabled:hover:border-[#0B6BCB] enabled:hover:bg-white`;
}

/** Percentage ring: orange neon arc around a floating glass centre mask. null renders an empty ring and "—". */
export function GlassGauge({ label, value, size = 88 }: { label: string; value: number | null; size?: number }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const pct = value === null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value));
  return (
    <figure role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      aria-valuetext={pct === null ? "No data" : `${Math.round(pct)} percent`}
      className="m-0 flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90 overflow-visible" aria-hidden="true">
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" stroke="#E6ECF2" />
          {pct !== null && (
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" stroke="currentColor"
              strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
              className="text-[#FF7A00] drop-shadow-[0_0_8px_rgba(255,122,0,0.6)] transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none" />
          )}
        </svg>
        <div className="absolute inset-[16%] grid place-items-center rounded-full border border-[rgba(255,255,255,0.04)] bg-white shadow-[0_2px_8px_rgba(15,42,68,0.12)]">
          <span className="mk-gauge-value text-base font-bold tabular-nums text-[#0F2A44]">{pct === null ? "—" : `${Math.round(pct)}%`}</span>
        </div>
      </div>
      <figcaption className="mk-gauge-label text-xs font-medium text-[#4E6479]">{label}</figcaption>
    </figure>
  );
}
