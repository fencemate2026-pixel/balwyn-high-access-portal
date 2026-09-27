// Bright Glass building blocks (25 Sep 2026 design brief).
// Square corners, zero purple, cyan glass edges, #FF7A00 orange for action and "today".
// Exact values from the brief:
//   glass bevel:  bg-[#101622]/35 backdrop-blur-xl border-[rgba(0,240,255,0.22)]
//   gauge centre: bg-[#121722]/80 border-[rgba(255,255,255,0.04)]
//   gauge fill:   text-[#FF7A00] drop-shadow-[0_0_8px_rgba(255,122,0,0.6)]

/** Primary glass panel: bright edge, inner top highlight, inner bottom shade, soft cyan halo. */
/** Header panels (Gate Schedules + Local weather): sidebar navy, so they read as
 *  part of the fixed frame that stays on every page, distinct from the white work area. */
export const GLASS_PANEL =
  "mk-glass mk-card mk-navy rounded-none bg-gradient-to-br from-[#0D3A63] to-[#062846] border border-[#1E5A8A] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_10px_28px_rgba(6,40,70,0.35)] text-[#F5FBFF]";

/** Secondary glass tile (calendar days, forecast days). */
export const GLASS_TILE =
  "mk-tile rounded-none bg-white/[0.06] border border-white/[0.14]";

export const GLASS_FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#5CC8FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#062846]";

/** Small glass button. Primary tone is the orange action. */
export function glassButton(tone: "glass" | "orange" = "glass") {
  const base = `inline-flex h-9 min-w-9 items-center justify-center gap-1.5 px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${GLASS_FOCUS}`;
  return tone === "orange"
    ? `${base} rounded-none border border-[#FF9A3D] bg-[#FF7A00] text-[#0A0E15] shadow-[0_0_14px_rgba(255,122,0,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] enabled:hover:bg-[#FF8F26]`
    : `${base} ${GLASS_TILE} text-[#F5FBFF] enabled:hover:border-[#5CC8FF] enabled:hover:bg-white/[0.12]`;
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
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" stroke="rgba(255,255,255,0.14)" />
          {pct !== null && (
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" stroke="currentColor"
              strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
              className="text-[#FF7A00] drop-shadow-[0_0_8px_rgba(255,122,0,0.6)] transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none" />
          )}
        </svg>
        <div className="absolute inset-[16%] grid place-items-center rounded-full border border-[rgba(255,255,255,0.04)] bg-[#0B3558] shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
          <span className="mk-gauge-value text-base font-bold tabular-nums text-[#F5FBFF]">{pct === null ? "—" : `${Math.round(pct)}%`}</span>
        </div>
      </div>
      <figcaption className="mk-gauge-label text-xs font-medium text-[#B9CFE2]">{label}</figcaption>
    </figure>
  );
}
