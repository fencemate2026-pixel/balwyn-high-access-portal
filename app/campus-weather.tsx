"use client";
import { useEffect, useState } from "react";
import { MapPin, RefreshCw, Wind } from "lucide-react";
import { GLASS_PANEL, GLASS_TILE, GlassGauge, glassButton } from "./glass-ui";
import WeatherIcon from "./weather-icon";

import type { Weather } from "@/lib/weather";
const number = (value: number | null | undefined, unit = "") => typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}${unit}` : "—";
export default function CampusWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort(); controller = new AbortController();
      try {
        const response = await fetch("/api/weather", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const body = await response.json();
        if (!response.ok || !body.current || !Array.isArray(body.days)) throw new Error("Weather unavailable");
        if (active) { setWeather(body); setError(false); }
      } catch (reason) { if (active && !(reason instanceof Error && reason.name === "AbortError")) { setError(true); setWeather(value => value && Date.now() - Date.parse(value.updatedAt) < 3600_000 ? value : null); } }
    };
    void load(); const timer = window.setInterval(load, 600_000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [revision]);
  const updated = weather ? new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).format(new Date(weather.updatedAt)) : "";
  return <section className={`campus-glass-weather ${GLASS_PANEL} relative flex min-w-0 flex-col gap-4 overflow-hidden p-5`} aria-labelledby="campus-weather-title">
    <header className="flex items-start justify-between gap-3">
      <div>
        <h2 id="campus-weather-title" className="m-0 flex items-center gap-2 text-base font-bold text-[#F5FBFF]"><MapPin className="size-4 text-[#00F0FF]" aria-hidden="true" /> Local weather</h2>
        <p className="m-0 mt-1 text-sm text-[#B3CEDF]">Balwyn, Victoria</p>
      </div>
      {weather && <p className="m-0 text-xs text-[#8FA9BD]" role="status">{error || weather.stale ? "Last available forecast · " : "Updated "}{updated}</p>}
    </header>
    {weather ? <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <WeatherIcon kind={weather.current.icon} size={64} />
          <div>
            <strong className="block text-5xl leading-none font-bold tabular-nums text-[#F5FBFF] drop-shadow-[0_0_12px_rgba(0,240,255,0.35)]">{number(weather.current.temp, "°")}</strong>
            <span className="mt-1 block text-sm text-[#B3CEDF]">{weather.current.label}</span>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-[#8FA9BD]"><Wind className="size-3.5" aria-hidden="true" /> Wind {number(weather.current.wind, " km/h")}</span>
          </div>
        </div>
        <div className="flex gap-4">
          <GlassGauge label="Rain chance today" value={weather.current.rainChance ?? null} />
          <GlassGauge label="Humidity" value={weather.current.humidity} />
        </div>
      </div>
      <ol className="m-0 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-7" aria-label="Seven-day forecast">{weather.days.slice(0, 7).map((day) => <li key={day.date} className={`${GLASS_TILE} flex flex-col items-center gap-0.5 px-1 py-2`} title={`${day.label}, high ${number(day.max, "°C")}, low ${number(day.min, "°C")}`}>
        <span className="text-xs font-bold text-[#B3CEDF]">{new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</span>
        <WeatherIcon kind={day.icon} size={26} />
        <span className="text-sm font-semibold tabular-nums text-[#F5FBFF]">{number(day.max, "°")}</span>
        <span className="text-xs tabular-nums text-[#8FA9BD]">{number(day.min, "°")}</span>
      </li>)}</ol>
      <div className="flex items-center justify-end gap-3 text-xs text-[#8FA9BD]"><a className="text-[#A8D5FF] underline" href={weather.source === "MET Norway" ? "https://www.met.no/en" : "https://open-meteo.com/"} target="_blank" rel="noopener noreferrer">Forecast: {weather.source}</a><button type="button" className={glassButton()} aria-label="Refresh Balwyn weather" onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" /></button></div>
    </> : <div className="flex min-h-32 items-center justify-between gap-3"><div><strong className="text-4xl font-bold text-[#8FA9BD]">—°</strong><p className="m-0 mt-1 text-sm text-[#FFB020]" role="status">{error ? "Forecast temporarily unavailable" : "Loading Balwyn forecast…"}</p></div>{error && <button type="button" className={glassButton()} aria-label="Retry Balwyn weather" onClick={() => setRevision((value) => value + 1)}><RefreshCw className="size-4" aria-hidden="true" /></button>}</div>}
  </section>;
}
