"use client";

import { useEffect, useMemo, useState } from "react";
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
  const days = useMemo(() => weekDates(), []);

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
  }, [days]);

  useEffect(() => {
    const header = document.querySelector(".workspace-header-right");
    const weatherRoot = document.getElementById("balwyn-forecast");
    if (header && weatherRoot && weatherRoot.parentElement !== header) header.insertBefore(weatherRoot, header.firstChild);
    const gates = document.querySelector(".active-dashboard-gates, .quick-gates-section");
    const chart = document.getElementById("week-hire-chart");
    if (gates && chart) gates.parentElement?.insertBefore(chart, gates);
  });

  const max = Math.max(1, ...counts);
  const totalBookings = counts.reduce((sum, value) => sum + value, 0);
  const busiestIndex = counts.reduce((best, value, index, array) => value > array[best] ? index : best, 0);
  const busiestCount = counts[busiestIndex] ?? 0;
  const busiestDay = days[busiestIndex]?.label ?? "";

  return (
    <>
      <div id="balwyn-forecast" className="balwyn-forecast" aria-label="Balwyn 7 day forecast" role="list">
        {(weather ?? []).slice(0, 7).map((day) => (
          <span key={day.date} className="forecast-day" role="listitem">
            <small>{new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Melbourne" }).format(new Date(`${day.date}T12:00:00+10:00`))}</small>
            <WeatherIcon kind={day.icon || "cloud"} />
            <b>{day.max == null ? "—" : `${Math.round(day.max)}°`}</b>
            <em>{day.min == null ? "No overnight low" : `Low ${Math.round(day.min)}°`}</em>
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
        <div className="week-chart-shell">
          <div className="week-chart-meta">
            <span className="week-chart-kicker">Facility demand</span>
            <strong>{totalBookings} confirmed booking{totalBookings === 1 ? "" : "s"}</strong>
            <small>{busiestCount ? `${busiestDay} is currently the busiest day with ${busiestCount} booking${busiestCount === 1 ? "" : "s"}.` : "No confirmed hire visits are currently booked this week."}</small>
          </div>
          <div className="week-chart-stage">
            <div className="week-chart-grid" aria-hidden="true">
              {[100, 75, 50, 25].map((level) => <i key={level} style={{ bottom: `${level}%` }} />)}
            </div>
            <div className="week-bars" role="list" aria-label="Upcoming facility hire demand for the next seven days">
              {days.map((day, index) => (
                <div key={day.date} className="week-bar-slot" role="listitem" aria-label={`${day.label}: ${counts[index]} confirmed booking${counts[index] === 1 ? "" : "s"}`}>
                  <small className="week-bar-value">{counts[index] || "0"}</small>
                  <span className={counts[index] === 0 ? "is-empty" : undefined} style={{ height: counts[index] === 0 ? "3px" : `${(counts[index] / max) * 100}%` }}>
                    <i />
                  </span>
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
