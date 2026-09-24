"use client";

// Facility hire — layout approved 23 Sep 2026:
//   top:          week board, one card per day (Mon–Sun, Melbourne time)
//   bottom-left:  client booking form (saves to /api/hire)
//   bottom-right: month calendar in the familiar desktop-calendar style
// Every figure on this page comes from /api/hire (balwyn_portal database).
// Nothing is sample data: an empty day means nothing is booked.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import "./facility-hire.css";

type HireArea = { key: string; label: string; active?: boolean };
type HireVisit = {
  occurrence_id?: string;
  schedule_name?: string;
  full_name?: string;
  organisation?: string | null;
  email?: string | null;
  phone?: string | null;
  occurs_on?: string;
  starts_at?: string;
  ends_at?: string;
  areas?: string[] | string;
  status?: string;
  deposit_status?: string;
  deposit_amount?: number | string;
};
type HirePayload = { areas: HireArea[]; visits: HireVisit[]; source?: string; error?: string };

const TZ = "Australia/Melbourne";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---- Date helpers. Dates are handled as YYYY-MM-DD strings in Melbourne time;
// arithmetic uses UTC noon so daylight-saving changes can never shift a day.
function melbourneToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function toUtcNoon(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const date = toUtcNoon(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}
function mondayOf(iso: string): string {
  const weekday = (toUtcNoon(iso).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(iso, -weekday);
}
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function addMonths(iso: string, months: number): string {
  const date = toUtcNoon(monthStart(iso));
  date.setUTCMonth(date.getUTCMonth() + months);
  return toIso(date);
}
function visitDate(visit: HireVisit): string {
  if (visit.occurs_on) return String(visit.occurs_on).slice(0, 10);
  if (!visit.starts_at) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(visit.starts_at));
}
function clock(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(date);
}
function areaList(visit: HireVisit): string[] {
  if (Array.isArray(visit.areas)) return visit.areas;
  if (typeof visit.areas === "string" && visit.areas.trim()) {
    return visit.areas.replace(/^\{|\}$/g, "").split(",").map((part) => part.replace(/^"|"$/g, "").trim()).filter(Boolean);
  }
  return [];
}
// Colour per hire area, shared by the week board, calendar and legend.
const AREA_COLOURS: Array<{ match: RegExp; className: string; label: string }> = [
  { match: /frizza|stadium/i, className: "fh-area-stadium", label: "Tony Frizza Stadium" },
  { match: /gym/i, className: "fh-area-gymnasium", label: "Gymnasium" },
  { match: /oval|ground/i, className: "fh-area-oval", label: "Oval and grounds" },
  { match: /tennis/i, className: "fh-area-tennis", label: "Tennis courts" },
  { match: /car ?park/i, className: "fh-area-carpark", label: "Car park" },
];
function areaClass(visit: HireVisit): string {
  const first = areaList(visit)[0] ?? "";
  return AREA_COLOURS.find((entry) => entry.match.test(first))?.className ?? "";
}
function visitTitle(visit: HireVisit): string {
  return visit.organisation || visit.full_name || visit.schedule_name || "Hire booking";
}
function statusLabel(visit: HireVisit): string {
  const status = String(visit.status ?? "confirmed");
  return status.charAt(0).toUpperCase() + status.slice(1);
}
function depositLabel(visit: HireVisit): string | null {
  const status = String(visit.deposit_status ?? "not_required");
  if (status === "not_required") return null;
  const amount = Number(visit.deposit_amount ?? 0);
  const money = amount > 0 ? ` $${amount.toFixed(2)}` : "";
  return `Deposit ${status}${money}`;
}
function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(toUtcNoon(iso));
}
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(toUtcNoon(iso));
}
function monthTitle(iso: string): { month: string; year: string } {
  const date = toUtcNoon(iso);
  return {
    month: new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long" }).format(date),
    year: String(date.getUTCFullYear()),
  };
}

export default function FacilityHirePanel() {
  const today = melbourneToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [monthCursor, setMonthCursor] = useState(() => monthStart(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [selectedVisit, setSelectedVisit] = useState<HireVisit | null>(null);

  const [data, setData] = useState<HirePayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("tony-frizza-stadium");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");
  const [depositLeft, setDepositLeft] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [comment, setComment] = useState("");

  // Month grid: 6 weeks starting on the Monday on/before the 1st.
  const gridStart = mondayOf(monthCursor);
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)), [gridStart]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  // One request covers both the visible week and the visible month.
  const weekEnd = weekDays[6];
  const gridEnd = gridDays[41];
  const rangeFrom = weekStart < gridStart ? weekStart : gridStart;
  const rangeTo = weekEnd > gridEnd ? weekEnd : gridEnd;

  const load = useCallback(async () => {
    const response = await fetch(`/api/hire?from=${rangeFrom}&to=${rangeTo}`, { cache: "no-store" });
    const body = await response.json() as HirePayload;
    if (!response.ok) throw new Error(body.error || "Hire records could not be loaded.");
    setData(body);
    setError(body.error ?? "");
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    let active = true;
    load().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Hire records could not be loaded.");
    });
    return () => { active = false; };
  }, [load]);

  const visitsByDay = useMemo(() => {
    const map = new Map<string, HireVisit[]>();
    for (const visit of data?.visits ?? []) {
      const key = visitDate(visit);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), visit]);
    }
    return map;
  }, [data]);

  function chooseDay(iso: string) {
    setSelectedDay(iso);
    setDate(iso);
    setSelectedVisit(null);
  }

  function jumpToToday() {
    setWeekStart(mondayOf(today));
    setMonthCursor(monthStart(today));
    chooseDay(today);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setNotice(""); setError("");
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
      setNotice(`Saved: ${fullName}, ${longDate(date)}, ${startTime}–${endTime}.`);
      setComment("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The hire record could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const title = monthTitle(monthCursor);
  const selectedVisits = visitsByDay.get(selectedDay) ?? [];

  return (
    <section className="hire-workspace fh" aria-label="Facility hire">
      <header className="fh-toolbar">
        <h2>Facility hire</h2>
        <div className="fh-toolbar-row">
          <span className="fh-range">{shortDate(weekStart)} – {shortDate(weekEnd)} {weekEnd.slice(0, 4)}</span>
          <div className="fh-nav">
            <button type="button" className="fh-3d" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft aria-hidden="true" /></button>
            <button type="button" className="fh-3d" onClick={jumpToToday}>Today</button>
            <button type="button" className="fh-3d" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight aria-hidden="true" /></button>
          </div>
          <a className="fh-3d fh-primary" href="#fh-booking"><Plus aria-hidden="true" /> New booking</a>
        </div>
      </header>

      <p className="fh-legend" aria-label="Area colours">
        {AREA_COLOURS.map((entry) => <span key={entry.className} className={entry.className}><i aria-hidden="true" />{entry.label}</span>)}
      </p>

      {error && <p className="fh-note fh-note-error" role="alert">{error}</p>}
      {notice && <p className="fh-note" role="status">{notice}</p>}

      {/* Week board */}
      <div className="fh-week" aria-label="Bookings this week">
        {weekDays.map((iso, index) => {
          const visits = visitsByDay.get(iso) ?? [];
          const isToday = iso === today;
          return (
            <article key={iso} className={`fh-day${isToday ? " is-today" : ""}${iso === selectedDay ? " is-selected" : ""}`} onClick={() => chooseDay(iso)}>
              <div className="fh-day-head">
                <span>{DAY_NAMES[index]}</span>
                <span className={`fh-day-num${isToday ? " is-today" : ""}`}>{Number(iso.slice(8))}</span>
              </div>
              {visits.length === 0 ? <p className="fh-empty">No bookings</p> : visits.map((visit, i) => (
                <button type="button" key={visit.occurrence_id ?? i} className={`fh-booking ${areaClass(visit)}`} onClick={(event) => { event.stopPropagation(); setSelectedVisit(visit); setSelectedDay(iso); }}>
                  <strong>{visitTitle(visit)}</strong>
                  <span>{clock(visit.starts_at)} – {clock(visit.ends_at)}</span>
                  {areaList(visit).length > 0 && <small>{areaList(visit).join(", ")}</small>}
                  <span className="fh-chips">
                    <em className={`fh-chip is-${visit.status ?? "confirmed"}`}>{statusLabel(visit)}</em>
                    {depositLabel(visit) && <em className="fh-chip is-deposit">{depositLabel(visit)}</em>}
                  </span>
                </button>
              ))}
            </article>
          );
        })}
      </div>

      <div className="fh-lower">
        {/* Client booking */}
        <article className="fh-panel" id="fh-booking">
          <h2><Users aria-hidden="true" /> Client booking</h2>
          <form className="fh-form" onSubmit={onSubmit}>
            <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} autoComplete="off" /></label>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" /></label>
            <label>Phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" /></label>
            <label>Space<select value={area} onChange={(event) => setArea(event.target.value)}>{(data?.areas ?? []).filter((item) => item.active !== false).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <label>Date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); if (event.target.value) setSelectedDay(event.target.value); }} required /></label>
            <div className="fh-times">
              <label>Start<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
              <label>End<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label>
            </div>
            <label className="fh-check"><input type="checkbox" checked={depositLeft} onChange={(event) => setDepositLeft(event.target.checked)} /> Deposit received</label>
            {depositLeft && <label>Deposit amount (AUD)<input type="number" min="0.01" step="0.01" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} required /></label>}
            <label className="fh-wide">Comments<textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Access notes, condition on arrival, damage noted" maxLength={4000} /></label>
            <button type="submit" className="fh-3d fh-primary fh-wide" disabled={saving}>{saving ? "Saving…" : "Save client and booking"}</button>
          </form>
        </article>

        {/* Month calendar */}
        <article className="fh-panel fh-month">
          <h2><CalendarDays aria-hidden="true" /> Calendar</h2>
          <div className="fh-month-head">
            <p className="fh-month-title"><strong>{title.month}</strong> {title.year}</p>
            <div className="fh-nav">
              <button type="button" className="fh-3d" aria-label="Previous month" onClick={() => setMonthCursor(addMonths(monthCursor, -1))}><ChevronLeft aria-hidden="true" /></button>
              <button type="button" className="fh-3d" onClick={jumpToToday}>Today</button>
              <button type="button" className="fh-3d" aria-label="Next month" onClick={() => setMonthCursor(addMonths(monthCursor, 1))}><ChevronRight aria-hidden="true" /></button>
            </div>
          </div>
          <div className="fh-month-grid" aria-label={`${title.month} ${title.year}`}>
            {DAY_NAMES.map((name) => <span key={name} className="fh-month-dow">{name}</span>)}
            {gridDays.map((iso) => {
              const inMonth = iso.slice(0, 7) === monthCursor.slice(0, 7);
              const visits = visitsByDay.get(iso) ?? [];
              const dayNumber = Number(iso.slice(8));
              return (
                <div key={iso} tabIndex={0}
                  className={`fh-cell${inMonth ? "" : " is-outside"}${iso === today ? " is-today" : ""}${iso === selectedDay ? " is-selected" : ""}`}
                  onClick={() => chooseDay(iso)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDay(iso); } }}>
                  <span className="fh-cell-num">{dayNumber === 1 && !inMonth ? shortDate(iso) : dayNumber}</span>
                  {visits.slice(0, 2).map((visit, i) => (
                    <button type="button" key={visit.occurrence_id ?? i} className={`fh-event is-${visit.status ?? "confirmed"} ${areaClass(visit)}`} onClick={(event) => { event.stopPropagation(); setSelectedVisit(visit); setSelectedDay(iso); }}>
                      <span>{visitTitle(visit)}</span><time>{clock(visit.starts_at)}</time>
                    </button>
                  ))}
                  {visits.length > 2 && <span className="fh-more">+{visits.length - 2} more</span>}
                </div>
              );
            })}
          </div>
          <div className="fh-detail" aria-live="polite">
            {selectedVisit ? (
              <>
                <strong>{visitTitle(selectedVisit)}</strong>
                <span>{longDate(visitDate(selectedVisit))}, {clock(selectedVisit.starts_at)} – {clock(selectedVisit.ends_at)}</span>
                {areaList(selectedVisit).length > 0 && <span>{areaList(selectedVisit).join(", ")}</span>}
                {selectedVisit.full_name && selectedVisit.organisation && <span>Contact: {selectedVisit.full_name}</span>}
                {selectedVisit.email && <span>{selectedVisit.email}</span>}
                {selectedVisit.phone && <span>{selectedVisit.phone}</span>}
                <span>{statusLabel(selectedVisit)}{depositLabel(selectedVisit) ? ` · ${depositLabel(selectedVisit)}` : ""}</span>
              </>
            ) : (
              <span>{selectedVisits.length === 0 ? `${longDate(selectedDay)}: nothing booked.` : `${longDate(selectedDay)}: select a booking to see its details.`}</span>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
