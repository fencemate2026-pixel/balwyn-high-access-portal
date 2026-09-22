"use client";

export default function WeatherIcon({ kind, size = 28 }: { kind?: string; size?: number }) {
  const k = kind || "cloud";
  const id = `wx-${k}-${Math.round(size)}`;
  return (
    <svg className={`wx-icon wx-${k}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-sun`} cx="38%" cy="32%" r="68%">
          <stop offset="0" stopColor="#fff8d2" />
          <stop offset=".35" stopColor="#ffd34a" />
          <stop offset="1" stopColor="#e09112" />
        </radialGradient>
        <radialGradient id={`${id}-cloud`} cx="32%" cy="28%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#d7e3ef" />
          <stop offset="1" stopColor="#9aafc2" />
        </radialGradient>
        <radialGradient id={`${id}-storm`} cx="32%" cy="28%" r="80%">
          <stop offset="0" stopColor="#c5d0dc" />
          <stop offset="1" stopColor="#4b5b6c" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.55" />
        </filter>
      </defs>
      {(k === "sun" || k === "sun-cloud") && (
        <g>
          <g opacity=".55" stroke="#ffcc4d" strokeWidth="2.2" strokeLinecap="round">
            <path d="M32 6v6M32 52v6M6 32h6M52 32h6M12 12l4 4M48 48l4 4M12 52l4-4M48 16l4-4" />
          </g>
          <circle cx={k === "sun-cloud" ? 24 : 32} cy={k === "sun-cloud" ? 24 : 32} r={k === "sun-cloud" ? 12 : 14} fill={`url(#${id}-sun)`} />
        </g>
      )}
      {(k === "cloud" || k === "sun-cloud" || k === "rain" || k === "storm" || k === "snow") && (
        <path
          filter={`url(#${id}-soft)`}
          fill={k === "storm" ? `url(#${id}-storm)` : `url(#${id}-cloud)`}
          d="M16 40c-6 0-10-4.4-10-10 0-5.2 3.8-9.5 8.8-10.2C16.6 13.6 23 9 31 9c9.2 0 16.4 6.4 17.6 15.2 5 .6 9.4 5 9.4 10.4 0 5.8-4.6 10.4-10.4 10.4H16z"
          transform={k === "sun-cloud" ? "translate(2 8)" : undefined}
        />
      )}
      {k === "rain" && (
        <g stroke="#7ec8ff" strokeWidth="2.4" strokeLinecap="round">
          <path d="M22 46l-3 10M32 46l-3 11M42 46l-3 10" />
        </g>
      )}
      {k === "storm" && <path d="M30 42l-6 12h7l-4 10 14-16h-8l7-6z" fill="#f3d15a" />}
      {k === "snow" && (
        <g stroke="#e8f3ff" strokeWidth="1.8" strokeLinecap="round">
          <path d="M32 44v12M26 50h12M27 46l10 8M27 54l10-8" />
        </g>
      )}
    </svg>
  );
}
