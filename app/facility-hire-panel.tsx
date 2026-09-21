"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  deposit_status?: string;
  deposit_amount?: number | string;
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
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("tony-frizza-stadium");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");
  const [depositLeft, setDepositLeft] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [comment, setComment] = useState("");

  async function load() {
    const response = await fetch("/api/hire", { cache: "no-store" });
    const body = await response.json() as HirePayload & { error?: string };
    if (!response.ok) throw new Error(body.error || "Hire records could not be loaded.");
    setData(body);
    if (body.error) setError(body.error);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Hire records could not be loaded."));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName, email, phone, area, date, startTime, endTime,
          depositLeft, depositAmount: depositLeft ? Number(depositAmount) : 0, comment,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The hire record could not be saved.");
      setNotice("Client and booking saved.");
      setComment("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The hire record could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hire-workspace" aria-label="Facility hire">
      <div className="view-panel-heading">
        <div>
          <h2>Facility hire</h2>
          <small>After-hours and weekend use. Times are Australia/Melbourne. Saving keeps the client on file.</small>
        </div>
      </div>
      {error && <p className="hire-note" role="status">{error}</p>}
      {notice && <p className="hire-note" role="status">{notice}</p>}
      <div className="hire-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h3><Users /> Client booking</h3>
              <small>Saved against the client record for later visits</small>
            </div>
          </div>
          <form className="hire-form" onSubmit={onSubmit}>
            <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} /></label>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label>Space
              <select value={area} onChange={(event) => setArea(event.target.value)}>
                {(data?.areas ?? []).map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            <label>Start<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
            <label>End<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label>
            <label className="wide">
              <input type="checkbox" checked={depositLeft} onChange={(event) => setDepositLeft(event.target.checked)} /> Deposit received
            </label>
            {depositLeft && (
              <label>Deposit amount (AUD)
                <input type="number" min="0.01" step="0.01" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} required />
              </label>
            )}
            <label className="wide">Comments
              <textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Left the space tidy, damage noted, access notes" maxLength={4000} />
            </label>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save client and booking"}</button>
          </form>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h3><CalendarDays /> Upcoming visits</h3>
              <small>Confirmed bookings on file</small>
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
                  {visit.deposit_status && visit.deposit_status !== "not_required" && (
                    <small>Deposit {visit.deposit_status} {visit.deposit_amount ? `AUD ${visit.deposit_amount}` : ""}</small>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h3><MapPin /> Hire areas</h3>
            </div>
          </div>
          <ul className="hire-area-list">
            {(data?.areas ?? []).map((item) => (
              <li key={item.key}>
                <strong>{item.label}</strong>
                <span>{item.active === false ? "Inactive" : "Available"}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
