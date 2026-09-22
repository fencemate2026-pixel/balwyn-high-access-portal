"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { weekCounts, weekDates, type HireVisit } from "./week-board";
import WeatherIcon from "./weather-icon";

type WeatherDay = {
  date: string;
  label: string;
  icon?: string;
  max: number | null;
  min: number | null;
};

function weatherKind(value?: string) {
  const kind = value?.toLowerCase();
  return kind === "sun" || kind === "sun-cloud" || kind === "rain" || kind === "storm" || kind === "snow" ? kind : "cloud";
}

function WeatherScene({ today }: { today: WeatherDay }) {
  const id = useId().replace(/:/g, "");
  const kind = weatherKind(today.icon);
  const rainy = kind === "rain" || kind === "storm";
  const showSun = kind === "sun" || kind === "sun-cloud";
  const label = kind === "sun" ? "Sunny" : kind === "sun-cloud" || kind === "cloud" ? "Partly cloudy" : kind === "storm" ? "Storm" : kind === "snow" ? "Snow" : "Rain";
  const temperature = today.max == null ? "—" : `${Math.round(today.max)}°`;

  return (
    <div className="weather-scene-card">
      <svg viewBox="0 0 380 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`weather-sky-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={rainy ? "#39475a" : "#3f8aca"} />
            <stop offset="1" stopColor={rainy ? "#718398" : "#a2d1ee"} />
          </linearGradient>
          <radialGradient id={`weather-sun-${id}`} cx="38%" cy="32%" r="70%">
            <stop offset="0" stopColor="#fff8cf" />
            <stop offset=".5" stopColor="#ffc62e" />
            <stop offset="1" stopColor="#f28c00" />
          </radialGradient>
          <radialGradient id={`weather-cloud-${id}`} cx="40%" cy="30%" r="80%">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".6" stopColor="#e6ebf1" />
            <stop offset="1" stopColor="#aeb8c4" />
          </radialGradient>
        </defs>
        <rect width="380" height="230" fill={`url(#weather-sky-${id})`} />
        {showSun && (
          <g transform="translate(250 70)">
            <g className="weather-sun-rays" opacity=".55">
              {Array.from({ length: 12 }, (_, index) => <rect key={index} x="-2" y="-62" width="4" height="18" rx="2" fill="#fff3b0" transform={`rotate(${index * 30})`} />)}
            </g>
            <circle r="40" fill="#ffd54a" opacity=".25" />
            <circle r="30" fill={`url(#weather-sun-${id})`} />
            <ellipse cx="-9" cy="-11" rx="10" ry="6" fill="#fff" opacity=".6" />
          </g>
        )}
        {kind !== "sun" && (
          <>
            <g className="weather-cloud" transform="translate(120 40) scale(3)">
              <ellipse cx="27" cy="38" rx="20" ry="4" fill="#000" opacity=".12" />
              <path d="M12 34a8 8 0 0 1 1-16 11 11 0 0 1 21-3 9 9 0 0 1 8 15 6 6 0 0 1-4 4Z" fill={`url(#weather-cloud-${id})`} />
            </g>
            <g className="weather-cloud weather-cloud-secondary" transform="translate(20 80) scale(2.2)" opacity=".92">
              <ellipse cx="27" cy="38" rx="20" ry="4" fill="#000" opacity=".12" />
              <path d="M12 34a8 8 0 0 1 1-16 11 11 0 0 1 21-3 9 9 0 0 1 8 15 6 6 0 0 1-4 4Z" fill={`url(#weather-cloud-${id})`} />
            </g>
          </>
        )}
        {rainy && Array.from({ length: 20 }, (_, index) => <line key={index} className="weather-drop" x1={20 + index * 18} y1={110} x2={16 + index * 18} y2={124} stroke="#cfe3ff" strokeWidth="2" strokeLinecap="round" style={{ animationDelay: `${(index * 0.11).toFixed(2)}s` }} />)}
        <rect y="190" width="380" height="40" fill="#000" opacity=".12" />
      </svg>
      <div className="weather-scene-location">Balwyn · today</div>
      <div className="weather-scene-readout"><strong>{temperature}</strong><span>{label}</span></div>
    </div>
  );
}

function WeatherPanel({ days }: { days: WeatherDay[] }) {
  const today = days[0];
  if (!today) return null;
  return (
    <section className="weather-panel" aria-label="Balwyn weather">
      <WeatherScene today={today} />
      <div className="weather-week-grid">
        {days.slice(0, 7).map((day, index) => (
          <article className="weather-week-day" key={day.date}>
            <b>{index === 0 ? "TODAY" : new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Melbourne" }).format(new Date(`${day.date}T12:00:00+10:00`)).toUpperCase()}</b>
            <WeatherIcon kind={day.icon || "cloud"} size={54} />
            <strong>{day.max == null ? "—" : `${Math.round(day.max)}°`}<small>{day.min == null ? "—" : `${Math.round(day.min)}°`}</small></strong>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function DashboardOpsStrip({ variant = "dashboard" }: { variant?: "dashboard" | "weather" | "chart" | "weather-panel" }) {
  const [weather, setWeather] = useState<WeatherDay[] | null>(null);
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const days = useMemo(() => weekDates(), []);

  useEffect(() => {
    if (variant === "chart") return;
    let active = true;
    void fetch("/api/weather", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => { if (active && Array.isArray(body.days)) setWeather(body.days); })
      .catch(() => { if (active) setWeather([]); });
    return () => { active = false; };
  }, [variant]);

  useEffect(() => {
    if (variant === "weather" || variant === "weather-panel") return;
    let active = true;
    void fetch("/api/hire", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!active) return;
        setCounts(weekCounts(Array.isArray(body.visits) ? body.visits as HireVisit[] : [], days));
      })
      .catch(() => { if (active) setCounts([0, 0, 0, 0, 0, 0, 0]); });
    return () => { active = false; };
  }, [days, variant]);

  const max = Math.max(1, ...counts);

  return (
    <>
      {variant === "weather-panel" && weather && <WeatherPanel days={weather} />}
      {(variant === "dashboard" || variant === "weather") && (
        <div id="balwyn-forecast" className="balwyn-forecast" aria-label="Balwyn 7 day forecast">
          {(weather ?? []).slice(0, 7).map((day) => (
            <span key={day.date} className="forecast-day">
              <small>{new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Melbourne" }).format(new Date(`${day.date}T12:00:00+10:00`))}</small>
              <WeatherIcon kind={day.icon || "cloud"} />
              <b>{day.max == null ? "—" : `${Math.round(day.max)}°`}</b>
            </span>
          ))}
        </div>
      )}
      {(variant === "dashboard" || variant === "chart") && (
        <article id="week-hire-chart" className="panel week-hire-chart">
          <div className="panel-heading">
            <div>
              <h2>Upcoming week</h2>
              <small>Confirmed hire in Australia/Melbourne. Zero means nothing is booked that day.</small>
            </div>
          </div>
          <div className="week-bars">
            {days.map((day, index) => (
              <div key={day.date}>
                <span style={{ height: `${Math.max(6, (counts[index] / max) * 88)}px` }}>{counts[index] || ""}</span>
                <small>{day.label}</small>
              </div>
            ))}
          </div>
        </article>
      )}
    </>
  );
}
