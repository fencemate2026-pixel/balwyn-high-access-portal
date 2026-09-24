"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, X } from "lucide-react";

type Visit = { occurrence_id?: string; occurs_on?: string; starts_at?: string; ends_at?: string; full_name?: string; organisation?: string; schedule_name?: string; areas?: string[] | string; status?: string };
const timezone = "Australia/Melbourne";
export function campusDate(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
export function shiftDate(date: string, offset: number) { const noon = new Date(`${date}T12:00:00Z`); noon.setUTCDate(noon.getUTCDate() + offset); return noon.toISOString().slice(0, 10); }
export function weekStart(date: string) { return shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)); }
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const clock = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Time pending";

export default function CampusCalendar({ onManage, canBook }: { onManage: () => void; canBook: boolean }) {
  const [today, setToday] = useState(campusDate);
  const [start, setStart] = useState(() => weekStart(campusDate()));
  const [selected, setSelected] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDate(start, index)), [start]);
  useEffect(() => { const timer = window.setInterval(() => setToday(campusDate()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort(); controller = new AbortController();
      try {
        const response = await fetch(`/api/hire?from=${start}&to=${shiftDate(start, 6)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || body.error || !Array.isArray(body.visits)) throw new Error("Bookings unavailable");
        if (active) { setVisits(body.visits); setError(""); }
      } catch (reason) { if (active && !(reason instanceof Error && reason.name === "AbortError")) { setVisits(null); setError("Bookings unavailable"); } }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    const refresh = () => { void load(); };
    window.addEventListener("campus-bookings-updated", refresh);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener("campus-bookings-updated", refresh); };
  }, [start, revision]);
  const byDay = useMemo(() => {
    const map = new Map<string, Visit[]>();
    (visits ?? []).forEach((visit) => { const date = visit.occurs_on?.slice(0, 10) || (visit.starts_at && Number.isFinite(Date.parse(visit.starts_at)) ? campusDate(new Date(visit.starts_at)) : ""); if (date) map.set(date, [...(map.get(date) ?? []), visit]); });
    return map;
  }, [visits]);
  const navigate = (date: string) => { setStart(date); setSelected(null); setVisits(null); setError(""); };
  return <section className="campus-calendar min-w-0 rounded-2xl border border-border bg-card p-4 shadow-card" aria-label="Campus calendar">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><span className="flex items-center gap-2 text-xs font-semibold text-foreground"><CalendarDays className="size-4 text-accent-blue" /> Campus calendar</span><p className="m-0 mt-1 text-[11px] text-muted-foreground">{dateLabel(start, { day: "numeric", month: "short" })} – {dateLabel(days[6], { day: "numeric", month: "short", year: "numeric" })}<span className="ml-2 text-[9px] tracking-wider uppercase">Melbourne</span></p></div><div className="flex items-center gap-1.5"><button className="chrome-icon" onClick={() => navigate(shiftDate(start, -7))} aria-label="Previous calendar week"><ChevronLeft /></button><button className="chrome-button" onClick={() => navigate(weekStart(campusDate()))}>Today</button><button className="chrome-icon" onClick={() => navigate(shiftDate(start, 7))} aria-label="Next calendar week"><ChevronRight /></button><button className="chrome-button calendar-manage" onClick={onManage}>{canBook ? <Plus className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}{canBook ? "New booking" : "View calendar"}</button></div></header>
    <div className="overflow-x-auto pb-1"><div className="grid min-w-[490px] grid-cols-7 gap-2">{days.map((date) => {
      const entries = byDay.get(date) ?? [];
      return <button type="button" key={date} className={`calendar-day relative min-h-24 rounded-xl border p-2.5 text-left transition ${date === today ? "is-today border-accent-blue/40 bg-accent-blue/10" : "border-border bg-background/35 hover:border-accent-blue/35 hover:bg-secondary"}`} aria-label={`${dateLabel(date, { weekday: "long", day: "numeric", month: "long" })}, ${visits === null ? error || "loading bookings" : `${entries.length} bookings`}`} aria-pressed={selected === date} onClick={() => setSelected(selected === date ? null : date)}>
        <span className="block text-[9px] tracking-wider text-muted-foreground uppercase">{dateLabel(date, { weekday: "short" })}</span><strong className={`mt-1 block text-xl font-medium ${date === today ? "text-accent-blue" : "text-foreground"}`}>{Number(date.slice(-2))}</strong><span className="mt-2 block truncate text-[9px] text-muted-foreground">{visits === null ? error ? "Unavailable" : "Loading…" : entries.length ? `${entries.length} booking${entries.length === 1 ? "" : "s"}` : "No bookings"}</span>{entries.length > 0 && <span className="absolute top-3 right-2 size-1.5 rounded-full bg-accent-green shadow-glow-green" />}
      </button>;
    })}</div></div>
    {error && <p className="m-0 mt-2 flex items-center justify-between text-xs text-status-warning" role="status">{error}<button className="chrome-icon" onClick={() => setRevision((value) => value + 1)} aria-label="Retry calendar"><RefreshCw /></button></p>}
    {selected && <div className="mt-3 rounded-xl border border-border bg-background/40 p-3"><div className="mb-2 flex items-center justify-between text-xs"><strong>{dateLabel(selected, { weekday: "long", day: "numeric", month: "short" })}</strong><button className="chrome-icon" onClick={() => setSelected(null)} aria-label="Close selected day"><X /></button></div>{visits === null ? <p className="text-xs text-muted-foreground">{error || "Loading bookings…"}</p> : (byDay.get(selected) ?? []).length ? (byDay.get(selected) ?? []).map((visit, index) => <div key={visit.occurrence_id ?? index} className="mb-2 border-l-2 border-accent-blue pl-3 text-xs"><strong>{visit.organisation || visit.full_name || visit.schedule_name || "Hire booking"}</strong><span className="block text-muted-foreground">{clock(visit.starts_at)} – {clock(visit.ends_at)} · {visit.status || "Status pending"}</span></div>) : <p className="text-xs text-muted-foreground">No bookings recorded for this day.</p>}</div>}
  </section>;
}
