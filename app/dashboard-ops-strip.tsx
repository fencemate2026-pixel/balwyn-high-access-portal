"use client";

import { useEffect, useState } from "react";
import { weekCounts, weekDates, type HireVisit } from "./week-board";
import WeatherIcon from "./weather-icon";

type WeatherDay = {
  date: string;
  label: string;
  icon?: string;
  max: number | null;
  min: number | null;
};

export default function DashboardOpsStrip() {
  const [weather, setWeather] = useState<WeatherDay[] | null>(null);
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const days = weekDates();

  useEffect(() => {
    let active = true;
    void fetch("/api/weather", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => { if (active && Array.isArray(body.days)) setWeather(body.days); })
      .catch(() => { if (active) setWeather([]); });
    void fetch("/api/hire", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!active) return;
        setCounts(weekCounts(Array.isArray(body.visits) ? body.visits as HireVisit[] : [], days));
      })
      .catch(() => { if (active) setCounts([0, 0, 0, 0, 0, 0, 0]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const header = document.querySelector(".workspace-header-right");
    const weatherRoot = document.getElementById("balwyn-forecast");
    if (header && weatherRoot && weatherRoot.parentElement !== header) header.insertBefore(weatherRoot, header.firstChild);
    const gates = document.querySelector(".active-dashboard-gates, .quick-gates-section");
    const chart = document.getElementById("week-hire-chart");
    if (gates && chart) gates.parentElement?.insertBefore(chart, gates);
  });

  const max = Math.max(1, ...counts);

  return (
    <>
      <div id="balwyn-forecast" className="balwyn-forecast" aria-label="Balwyn 7 day forecast">
        {(weather ?? []).slice(0, 7).map((day) => (
          <span key={day.date} className="forecast-day">
            <small>{new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Melbourne" }).format(new Date(`${day.date}T12:00:00+10:00`))}</small>
            <WeatherIcon kind={day.icon || "cloud"} />
            <b>{day.max == null ? "—" : `${Math.round(day.max)}°`}</b>
          </span>
        ))}
      </div>
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
    </>
  );
}
