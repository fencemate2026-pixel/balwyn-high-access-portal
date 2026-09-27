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
const clockShort = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: false }).format(new Date(value)) : "";
const clock = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Time pending";

type GateWindow = { gateId: string; gateName: string; source: "schedule" | "booking" | "automation"; label: string; start: string; end: string; date: string };
const SOURCE_TEXT: Record<GateWindow["source"], string> = { schedule: "Weekly schedule", booking: "Stadium hire", automation: "Automation" };
const SOURCE_TONE: Record<GateWindow["source"], string> = {
  schedule: "bg-[#5CC8FF]/15 text-[#BFE9FF] border-[#5CC8FF]/40",
  booking: "bg-[#FF7A00]/15 text-[#FFD2A8] border-[#FF7A00]/40",
  automation: "bg-[#E9F7EF] text-[#5BE39A] border-[#B9E3C9]",
};

/**
 * School scheduler: one week of facility-hire bookings AND gate open windows.
 * Reads /api/calendar, which uses the same window engine as the gate
 * controllers — anything scheduled (weekly schedule, hire booking with a gate,
 * automation rule) appears here exactly as the gates will be asked to act.
 */
export default function CampusCalendar({ onManage, canBook }: { onManage: () => void; canBook: boolean }) {
  const [today, setToday] = useState(campusDate);
  const [start, setStart] = useState(() => weekStart(campusDate()));
  const [selected, setSelected] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [windows, setWindows] = useState<GateWindow[]>([]);
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
        const response = await fetch(`/api/calendar?from=${start}&to=${shiftDate(start, 6)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || body.error || !Array.isArray(body.bookings)) throw new Error("Calendar unavailable");
        if (active) { setVisits(body.bookings); setWindows(Array.isArray(body.gateWindows) ? body.gateWindows : []); setError(""); }
      } catch (reason) { if (active && !(reason instanceof Error && reason.name === "AbortError")) { setVisits(null); setWindows([]); setError("Calendar unavailable"); } }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    const refresh = () => { void load(); };
    // Fired after a booking, schedule or automation rule is saved anywhere in the portal.
    window.addEventListener("campus-bookings-updated", refresh);
    window.addEventListener("gate-windows-updated", refresh);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener("campus-bookings-updated", refresh); window.removeEventListener("gate-windows-updated", refresh); };
  }, [start, revision]);
  const byDay = useMemo(() => {
    const map = new Map<string, Visit[]>();
    (visits ?? []).forEach((visit) => { const date = visit.occurs_on?.slice(0, 10) || (visit.starts_at && Number.isFinite(Date.parse(visit.starts_at)) ? campusDate(new Date(visit.starts_at)) : ""); if (date) map.set(date, [...(map.get(date) ?? []), visit]); });
    return map;
  }, [visits]);
  const windowsByDay = useMemo(() => {
    const map = new Map<string, GateWindow[]>();
    windows.forEach((window) => map.set(window.date, [...(map.get(window.date) ?? []), window]));
    return map;
  }, [windows]);
  const navigate = (date: string) => { setStart(date); setSelected(null); setVisits(null); setWindows([]); setError(""); };
  const rangeLabel = `${dateLabel(start, { day: "numeric", month: "short" })} – ${dateLabel(days[6], { day: "numeric", month: "short", year: "numeric" })}, Melbourne`;
  const loading = visits === null && !error;
  return <section className={`campus-glass-calendar ${GLASS_PANEL} flex min-w-0 flex-col gap-4 p-5`} aria-labelledby="campus-calendar-title">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="campus-calendar-title" className="m-0 flex items-center gap-2 text-base font-bold"><CalendarDays className="size-5 text-[#5CC8FF]" aria-hidden="true" /> Gate Schedules</h2>
        <p className="m-0 mt-1 text-sm text-[#B9CFE2]">{rangeLabel}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={glassButton()} onClick={() => navigate(shiftDate(start, -7))} aria-label="Previous calendar week"><ChevronLeft className="size-4" aria-hidden="true" /></button>
        <button type="button" className={glassButton()} onClick={() => navigate(weekStart(campusDate()))}>Today</button>
        <button type="button" className={glassButton()} onClick={() => navigate(shiftDate(start, 7))} aria-label="Next calendar week"><ChevronRight className="size-4" aria-hidden="true" /></button>
        <button type="button" className={glassButton("orange")} onClick={onManage}>{canBook ? <Plus className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}{canBook ? "New booking" : "View calendar"}</button>
      </div>
    </header>
    {/* Seven equal columns; scrolls sideways on narrow phones instead of wrapping. */}
    <div className="-mx-1 flex flex-1 overflow-x-auto px-1 pb-1"><ol className="m-0 grid w-full min-w-[640px] list-none grid-cols-7 gap-2 p-0">{days.map((date) => {
      const entries = byDay.get(date) ?? [];
      const gateWins = windowsByDay.get(date) ?? [];
      const isToday = date === today;
      const isSelected = selected === date;
      const state = isToday ? "border-[#FF7A00] bg-[#FF7A00]/20 shadow-[0_0_0_1px_#FF7A00]" : isSelected ? "border-[#5CC8FF] shadow-[0_0_0_1px_#5CC8FF]" : "";
      return <li key={date}><button type="button" className={`${GLASS_TILE} ${state} ${GLASS_FOCUS} relative flex h-full min-h-[118px] w-full flex-col items-start gap-1 p-3 text-left transition-colors hover:border-[#5CC8FF]`}
        aria-current={isToday ? "date" : undefined} aria-pressed={isSelected}
        aria-label={`${dateLabel(date, { weekday: "long", day: "numeric", month: "long" })}: ${loading ? "loading" : `${entries.length} bookings, ${gateWins.length} gate open windows`}`}
        onClick={() => setSelected(isSelected ? null : date)}>
        <span className={`text-xs font-bold uppercase tracking-wide ${isToday ? "text-[#FFB26B]" : "text-[#B9CFE2]"}`}>{dateLabel(date, { weekday: "short" })}</span>
        <strong className={`text-2xl leading-none font-bold tabular-nums ${isToday ? "text-[#FF7A00]" : "text-[#F5FBFF]"}`}>{Number(date.slice(-2))}</strong>
        {/* Up to two items per day; the rest are counted. Details open on click. */}
        <span className="mt-1 flex w-full min-w-0 flex-col gap-1">
          {[...entries.map((visit) => ({ key: `b-${visit.occurrence_id}`, tone: "border-[#FF7A00] bg-[#FF7A00]/20 text-[#FFD2A8]", text: `${clockShort(visit.starts_at)} ${visit.organisation || visit.full_name || "Hire"}` })),
            ...gateWins.map((window) => ({ key: `g-${window.gateId}-${window.start}`, tone: "border-[#22C55E] bg-[#22C55E]/15 text-[#A7F3C8]", text: `${clockShort(window.start)} Gate open` }))]
            .slice(0, 2).map((item) => <span key={item.key} className={`mk-chip block truncate border-l-2 px-1.5 py-0.5 font-semibold ${item.tone}`}>{item.text}</span>)}
          {entries.length + gateWins.length > 2 && <span className="text-[11px] font-semibold text-[#5CC8FF]">+{entries.length + gateWins.length - 2} more</span>}
        </span>
        <span className="mt-auto text-xs whitespace-nowrap text-[#8FB0CF]">{loading ? "Loading…" : error ? "Unavailable" : entries.length ? `${entries.length} booking${entries.length === 1 ? "" : "s"}` : "No bookings"}</span>
      </button></li>;
    })}</ol></div>
    {error && <p className="m-0 flex items-center justify-between text-sm text-[#FFB020]" role="status">{error}<button type="button" className={glassButton()} onClick={() => setRevision((value) => value + 1)} aria-label="Retry calendar"><RefreshCw className="size-4" aria-hidden="true" /></button></p>}
    {selected && <div className={`${GLASS_TILE} grid gap-4 p-4 md:grid-cols-2`}>
      <div className="md:col-span-2 flex items-center justify-between text-sm text-[#F5FBFF]"><strong>{dateLabel(selected, { weekday: "long", day: "numeric", month: "long" })}</strong><button type="button" className={glassButton()} onClick={() => setSelected(null)} aria-label="Close selected day"><X className="size-4" aria-hidden="true" /></button></div>
      <div>
        <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-[#B9CFE2]">Bookings</h3>
        {(byDay.get(selected) ?? []).length ? (byDay.get(selected) ?? []).map((visit, index) => <div key={visit.occurrence_id ?? index} className="mb-2 border-l-2 border-[#FF7A00] pl-3 text-sm text-[#F5FBFF]"><strong>{visit.organisation || visit.full_name || visit.schedule_name || "Hire booking"}</strong><span className="block text-[#B9CFE2]">{clock(visit.starts_at)} – {clock(visit.ends_at)}{Array.isArray(visit.areas) && visit.areas.length ? ` · ${visit.areas.join(", ")}` : ""}</span></div>) : <p className="m-0 text-sm text-[#8FB0CF]">No bookings.</p>}
      </div>
      <div>
        <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-[#B9CFE2]">Gate open windows</h3>
        {(windowsByDay.get(selected) ?? []).length ? (windowsByDay.get(selected) ?? []).map((window) => <div key={`${window.gateId}-${window.start}-${window.source}`} className="mb-2 flex items-start justify-between gap-3 border-l-2 border-[#22C55E] pl-3 text-sm text-[#F5FBFF]"><span><strong>{window.gateName}</strong><span className="block text-[#B9CFE2]">{clock(window.start)} – {clock(window.end)} · {window.label}</span></span><span className={`shrink-0 border px-2 py-0.5 text-[11px] font-semibold ${SOURCE_TONE[window.source]}`}>{SOURCE_TEXT[window.source]}</span></div>) : <p className="m-0 text-sm text-[#8FB0CF]">No gate automation this day.</p>}
      </div>
    </div>}
  </section>;
}
