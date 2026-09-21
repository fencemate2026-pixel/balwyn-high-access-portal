"use client";

export default function WeatherIcon({ kind, size = 22 }: { kind?: string; size?: number }) {
  const k = kind || "cloud";
  return (
    <svg className={`wx-icon wx-${k}`} width={size} height={size} viewBox="0 0 54 54" aria-hidden="true">
      {(k === "sun" || k === "sun-cloud") && (
        <>
          <defs>
            <radialGradient id={`sg-${k}`} cx="38%" cy="32%" r="70%">
              <stop offset="0" stopColor="#fff6c2" />
              <stop offset=".45" stopColor="#ffc62e" />
              <stop offset="1" stopColor="#f08a00" />
            </radialGradient>
          </defs>
          <circle cx={k === "sun-cloud" ? 21 : 27} cy={k === "sun-cloud" ? 20 : 27} r="13" fill={`url(#sg-${k})`} />
          <circle cx={k === "sun-cloud" ? 21 : 27} cy={k === "sun-cloud" ? 20 : 27} r="17" fill="#ffc62e" opacity=".25" />
        </>
      )}
      {(k === "cloud" || k === "sun-cloud" || k === "rain" || k === "storm" || k === "snow") && (
        <path d="M12 34a8 8 0 0 1 1-16 11 11 0 0 1 21-3 9 9 0 0 1 8 15 6 6 0 0 1-4 4Z" fill={k === "storm" ? "#8b98a8" : "#e8eef4"} stroke="#9aa6b4" strokeWidth="1" transform={k === "sun-cloud" ? "translate(4 6)" : undefined} />
      )}
      {k === "rain" && (
        <g stroke="#3d8bff" strokeWidth="2.4" strokeLinecap="round">
          <line x1="18" y1="40" x2="16" y2="47" />
          <line x1="27" y1="40" x2="25" y2="48" />
          <line x1="36" y1="40" x2="34" y2="47" />
        </g>
      )}
      {k === "storm" && <polygon points="26,36 22,46 28,44 24,52 36,40 29,41 32,36" fill="#ffd54a" />}
      {k === "snow" && (
        <g stroke="#dbeafe" strokeWidth="1.6">
          <line x1="27" y1="38" x2="27" y2="50" />
          <line x1="21" y1="44" x2="33" y2="44" />
        </g>
      )}
      {k === "sun" && <ellipse cx="22" cy="21" rx="4.5" ry="3" fill="#fff" opacity=".7" />}
    </svg>
  );
}
