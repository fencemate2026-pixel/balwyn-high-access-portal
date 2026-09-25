"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, X } from "lucide-react";
import { GLASS_FOCUS, GLASS_PANEL, GLASS_TILE, glassButton } from "./glass-ui";

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
  const rangeLabel = `${dateLabel(start, { day: "numeric", month: "short" })} – ${dateLabel(days[6], { day: "numeric", month: "short", year: "numeric" })}, Melbourne`;
  const countText = (entries: Visit[]) => visits === null ? (error ? "Unavailable" : "Loading…") : entries.length ? `${entries.length} booking${entries.length === 1 ? "" : "s"}` : "No bookings";
  return <section className={`campus-glass-calendar ${GLASS_PANEL} flex min-w-0 flex-col gap-4 p-5`} aria-labelledby="campus-calendar-title">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="campus-calendar-title" className="m-0 flex items-center gap-2 text-base font-bold text-[#F5FBFF]"><CalendarDays className="size-4 text-[#00F0FF]" aria-hidden="true" /> Campus calendar</h2>
        <p className="m-0 mt-1 text-sm text-[#B3CEDF]">{rangeLabel}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={glassButton()} onClick={() => navigate(shiftDate(start, -7))} aria-label="Previous calendar week"><ChevronLeft className="size-4" aria-hidden="true" /></button>
        <button type="button" className={glassButton()} onClick={() => navigate(weekStart(campusDate()))}>Today</button>
        <button type="button" className={glassButton()} onClick={() => navigate(shiftDate(start, 7))} aria-label="Next calendar week"><ChevronRight className="size-4" aria-hidden="true" /></button>
        <button type="button" className={glassButton("orange")} onClick={onManage}>{canBook ? <Plus className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{canBook ? "New booking" : "View calendar"}</button>
      </div>
    </header>
    {/* Seven fixed columns; scrolls sideways on narrow phones instead of wrapping. */}
    <div className="-mx-1 flex flex-1 overflow-x-auto px-1 pb-1"><ol className="m-0 grid w-full min-w-[560px] list-none grid-cols-7 gap-2 p-0">{days.map((date) => {
      const entries = byDay.get(date) ?? [];
      const isToday = date === today;
      const isSelected = selected === date;
      const state = isToday
        ? "border-[#FF7A00] bg-[#FF7A00]/15 shadow-[0_0_22px_rgba(255,122,0,0.60),inset_0_1px_0_rgba(255,255,255,0.18)]"
        : isSelected ? "border-[#00F0FF] shadow-[0_0_14px_rgba(0,240,255,0.35)]" : "";
      return <li key={date}><button type="button" className={`${GLASS_TILE} ${state} ${GLASS_FOCUS} relative flex h-full min-h-[112px] w-full flex-col items-start gap-1 p-3 text-left transition-colors hover:border-[rgba(0,240,255,0.45)]`}
        aria-current={isToday ? "date" : undefined} aria-pressed={isSelected}
        aria-label={`${dateLabel(date, { weekday: "long", day: "numeric", month: "long" })}, ${visits === null ? error || "loading bookings" : `${entries.length} bookings`}`}
        onClick={() => setSelected(isSelected ? null : date)}>
        <span className={`text-xs font-bold uppercase ${isToday ? "text-[#FF9A3D]" : "text-[#B3CEDF]"}`}>{dateLabel(date, { weekday: "short" })}</span>
        <strong className={`text-2xl font-bold tabular-nums ${isToday ? "text-[#FF7A00]" : "text-[#F5FBFF]"}`}>{Number(date.slice(-2))}</strong>
        <span className={`mt-auto text-xs leading-tight ${entries.length ? "text-[#00F0FF]" : "text-[#8FA9BD]"}`}>{countText(entries)}</span>
        {entries.length > 0 && <span className="absolute top-3 right-3 size-2 rounded-full bg-[#22E07A] shadow-[0_0_8px_rgba(34,224,122,0.8)]" aria-hidden="true" />}
      </button></li>;
    })}</ol></div>
    {error && <p className="m-0 flex items-center justify-between text-sm text-[#FFB020]" role="status">{error}<button type="button" className={glassButton()} onClick={() => setRevision((value) => value + 1)} aria-label="Retry calendar"><RefreshCw className="size-4" aria-hidden="true" /></button></p>}
    {selected && <div className={`${GLASS_TILE} p-3`}><div className="mb-2 flex items-center justify-between text-sm text-[#F5FBFF]"><strong>{dateLabel(selected, { weekday: "long", day: "numeric", month: "short" })}</strong><button type="button" className={glassButton()} onClick={() => setSelected(null)} aria-label="Close selected day"><X className="size-4" aria-hidden="true" /></button></div>{visits === null ? <p className="m-0 text-sm text-[#B3CEDF]">{error || "Loading bookings…"}</p> : (byDay.get(selected) ?? []).length ? (byDay.get(selected) ?? []).map((visit, index) => <div key={visit.occurrence_id ?? index} className="mb-2 border-l-2 border-[#00F0FF] pl-3 text-sm text-[#F5FBFF]"><strong>{visit.organisation || visit.full_name || visit.schedule_name || "Hire booking"}</strong><span className="block text-[#B3CEDF]">{clock(visit.starts_at)} – {clock(visit.ends_at)} · {visit.status || "Status pending"}</span></div>) : <p className="m-0 text-sm text-[#B3CEDF]">No bookings recorded for this day.</p>}</div>}
  </section>;
}
