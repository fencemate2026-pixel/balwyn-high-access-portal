"use client";

import { useEffect, useState } from "react";
import { CalendarDays, MapPin, Users } from "lucide-react";

type HireArea = { key: string; label: string; active?: boolean };
type HireVisit = {
  occurrence_id?: string;
  schedule_name?: string;
  full_name?: string;
  organisation?: string | null;
  starts_at?: string;
  ends_at?: string;
  areas?: string[] | string;
};

type HirePayload = {
  areas: HireArea[];
  visits: HireVisit[];
  source: "database" | "directory";
  error?: string;
};

function formatWhen(value?: string) {
  if (!value) return "Time not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export default function FacilityHirePanel() {
  const [data, setData] = useState<HirePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/hire", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as HirePayload & { error?: string };
        if (!response.ok) throw new Error(body.error || "Hire records could not be loaded.");
        return body;
      })
      .then((body) => { if (active) setData(body); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Hire records could not be loaded."); });
    return () => { active = false; };
  }, []);

  return (
    <section className="hire-workspace" aria-label="Facility hire">
      <div className="view-panel-heading">
        <div>
          <h2>Facility hire</h2>
          <small>After-hours and weekend use of the stadium and grounds. Times are Australia/Melbourne.</small>
        </div>
      </div>
      {error && <p className="hire-note" role="status">{error}</p>}
      {data?.source === "directory" && (
        <p className="hire-note" role="status">
          Area directory is shown. Confirmed visits appear after the balwyn_portal hire tables are applied.
        </p>
      )}
      <div className="hire-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h3><MapPin /> Hire areas</h3>
              <small>Spaces that can be booked</small>
            </div>
          </div>
          <ul className="hire-area-list">
            {(data?.areas ?? []).map((area) => (
              <li key={area.key}>
                <strong>{area.label}</strong>
                <span>{area.active === false ? "Inactive" : "Available"}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h3><CalendarDays /> Upcoming visits</h3>
              <small>Confirmed or completed occurrences only</small>
            </div>
          </div>
          {(data?.visits?.length ?? 0) === 0 ? (
            <p className="hire-empty">No confirmed hire visits are on the run sheet.</p>
          ) : (
            <ul className="hire-visit-list">
              {data!.visits.map((visit, index) => (
                <li key={visit.occurrence_id || String(index)}>
                  <strong>{visit.schedule_name || "Hire visit"}</strong>
                  <span><Users /> {visit.organisation || visit.full_name || "Client on file"}</span>
                  <span>{formatWhen(visit.starts_at)} – {formatWhen(visit.ends_at)}</span>
                  <small>{Array.isArray(visit.areas) ? visit.areas.join(", ") : visit.areas || "Area not listed"}</small>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
