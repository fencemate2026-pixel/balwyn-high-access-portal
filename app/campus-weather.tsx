"use client";
import { useEffect, useState } from "react";
import { Droplets, MapPin, RefreshCw, Wind } from "lucide-react";
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
  return <section className="campus-weather relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card" aria-label="Balwyn weather">
    <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs font-semibold"><MapPin className="size-3.5 text-accent-blue" /> Balwyn, Victoria</span><span className="text-[9px] tracking-wider text-muted-foreground uppercase">Local forecast</span></div>
    {weather ? <><div className="weather-current flex items-center gap-3"><WeatherIcon kind={weather.current.icon} size={66} /><div><strong className="text-[32px] leading-tight font-medium tracking-tight">{number(weather.current.temp, "°")}<span className="text-sm font-normal text-muted-foreground">C</span></strong><span className="block text-[10px] text-secondary-foreground">{weather.current.label}</span></div><div className="ml-auto grid gap-2 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><Wind className="size-3" /> {number(weather.current.wind, " km/h")}</span><span className="flex items-center gap-1.5"><Droplets className="size-3" /> {number(weather.current.humidity, "%")}</span></div></div><div className="grid grid-cols-7 gap-1 border-t border-border pt-2">{weather.days.slice(0, 7).map((day) => <div key={day.date} className="flex flex-col items-center" title={`${day.label}, high ${number(day.max, "°C")}, low ${number(day.min, "°C")}`}><small className="text-[8px] text-muted-foreground uppercase">{new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</small><WeatherIcon kind={day.icon} size={24} /><span className="text-[10px]">{number(day.max, "°")} <small className="text-[8px] text-muted-foreground">{number(day.min, "°")}</small></span></div>)}</div><div className="weather-attribution"><span role="status">{error || weather.stale ? "Last available forecast · " : "Updated "}{new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).format(new Date(weather.updatedAt))}</span><a href={weather.source === "MET Norway" ? "https://www.met.no/en" : "https://open-meteo.com/"} target="_blank" rel="noopener noreferrer">{weather.source}</a><button className="chrome-icon" aria-label="Refresh Balwyn weather" onClick={() => setRevision(value => value + 1)}><RefreshCw /></button></div></> : <div className="flex min-h-32 items-center justify-between gap-3"><div><strong className="text-3xl font-light text-muted-foreground">—°</strong><p className="m-0 text-xs text-muted-foreground" role="status">{error ? "Forecast temporarily unavailable" : "Loading Balwyn forecast…"}</p></div>{error && <button className="chrome-icon" aria-label="Retry Balwyn weather" onClick={() => setRevision((value) => value + 1)}><RefreshCw /></button>}</div>}
  </section>;
}
