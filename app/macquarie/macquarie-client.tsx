"use client";

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { Activity, CalendarDays, ChevronLeft, ChevronRight, MousePointer2, Radio, RotateCcw, ShieldCheck, Thermometer } from "lucide-react";
import BrandLogo from "../brand-logo";
import CampusWeather from "../campus-weather";
import { campusDate, shiftDate, weekStart } from "../campus-calendar";
import GateTile from "../gate-tile";
import { GLASS_FOCUS, GLASS_PANEL, GLASS_TILE, glassButton } from "../glass-ui";
import type { Gate, GatePosition, GateVisualState } from "@/lib/portal-model";

type WindowItem = { id: string; name: string; openTime: string; closeTime: string; days: number[]; spanDays: number; enabled: boolean };
type Caller = { id: string; name: string; phone: string; enabled: boolean };
type PortalEmail = { email: string; displayName: string; kept: boolean };
type Snapshot = {
  signedIn: boolean;
  viewer?: { email: string; displayName: string };
  linkNote?: string | null;
  usersNote?: string | null;
  callersWritable?: boolean;
  sliding?: { name: string; gateType: string; online: boolean; lastSeen: string | null; ageSeconds: number | null; held: boolean } | null;
  callers?: Caller[];
  windows?: WindowItem[];
  portalUsers?: PortalEmail[];
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GATE: Gate = {
  id: "sliding",
  name: "Sliding gate",
  area: "Macquarie Drive",
  type: "Sliding gate",
  kind: "sliding",
  active: true,
  group: "front",
  defaultPosition: "closed",
};

function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-AU", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function weekdayNumber(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string; signedIn?: boolean; reload?: boolean; activityLogged?: boolean };
  return { response, payload };
}

export default function MacquarieClient() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [start, setStart] = useState(() => weekStart(campusDate()));
  const [today, setToday] = useState(campusDate);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHold, setShowHold] = useState(false);
  const [holdName, setHoldName] = useState("Hold open");
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("17:00");
  const [holdDays, setHoldDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [callerName, setCallerName] = useState("");
  const [callerPhone, setCallerPhone] = useState("");
  const [personName, setPersonName] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [picture, setPicture] = useState<GatePosition | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(campusDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/macquarie", { cache: "no-store" });
        const body = await response.json().catch(() => null) as Snapshot | null;
        if (!active) return;
        if (!response.ok || !body?.signedIn) setData(null);
        else setData(body);
      } catch { if (active) setNotice("The page could not reach the portal."); }
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [revision]);

  const signedIn = Boolean(data?.signedIn && data.viewer);
  const sliding = data?.sliding ?? null;
  const canChange = Boolean(signedIn && sliding && !busy);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDate(start, index)), [start]);
  const gate = { ...GATE, name: sliding?.name || "Sliding gate" };
  const position: GateVisualState = sliding?.held ? "open" : "unknown";
  const pictureTarget: GatePosition | null = picture ?? (sliding?.held ? "open" : null);
  const pictureLabel = picture === "open"
    ? "Open picture · preview, not a position sensor"
    : picture === "closed"
    ? "Close picture · preview, not a position sensor"
    : sliding?.held
    ? "Held open by a schedule"
    : "Position unknown";
  const ariaLabel = picture === "open"
    ? `${gate.name} open picture. The leaf slides aside. This is a preview, not a position sensor.`
    : picture === "closed"
    ? `${gate.name} close picture. The leaf slides across the opening. This is a preview, not a position sensor.`
    : sliding?.held
    ? `${gate.name} held open by a schedule. The picture is the hold, not a position sensor.`
    : `${gate.name} position unknown. This gate has no open or closed sensor.`;
  const age = sliding?.ageSeconds ?? null;

  async function send(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const { response, payload } = await post(path, body);
      if (response.status === 403) {
        setNotice("Sign-in has to be done on the secure site. This page can be viewed here. A code is not sent from an insecure page.");
        return payload;
      }
      if (payload.signedIn === false) setData(null);
      else if (payload.signedIn) setData(payload as Snapshot);
      else if (payload.reload) setRevision((value) => value + 1);
      const text = payload.message || payload.error || "";
      if (text && (!response.ok || payload.activityLogged === false)) setNotice(text);
      else if (text && path.endsWith("/auth")) setNotice(text);
      else if (text && response.ok && body.action !== "click") setNotice(text);
      if (!response.ok && !text) setNotice("That request was not completed.");
      return payload;
    } finally { setBusy(false); }
  }

  function logClick(target: string, label?: string) {
    if (!signedIn) return;
    void send("/api/macquarie", { action: "click", target, label });
  }

  async function askCode(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setNotice("");
    await send("/api/macquarie/auth", { action: "request-code", email });
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const payload = await send("/api/macquarie/auth", { action: "verify-code", email, code });
    if (payload && !payload.error && payload.message?.startsWith("Signed in")) {
      setCode("");
      setRevision((value) => value + 1);
    }
  }

  async function signOut() {
    setNotice("");
    await send("/api/macquarie/auth", { action: "sign-out" });
    setData(null);
  }

  function openFire() {
    const panel = document.getElementById("fire-info");
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    logClick("info-fire");
  }

  return <div className="control-portal macquarie-portal">
    <div className="portal-workspace">
      <header className="workspace-header">
        <div className="workspace-location">
          <BrandLogo tone="dark" />
          <div className="macquarie-place"><strong>Macquarie Drive, Thomastown</strong><small>Sliding gate</small></div>
          <div className="header-safety" role="region" aria-label="Site status">
            <div className="safety-bar-status"><i className="status-dot" /><span><small>System state</small><strong>No emergency active</strong></span></div>
            <button type="button" className="macquarie-fire-info" onClick={openFire}>Fire evacuation info</button>
          </div>
        </div>
        <div className="workspace-header-right">
          <span className={`connection-pill macquarie-gate-pill ${sliding?.online ? "is-online" : ""}`}><i />{gate.name} {signedIn ? (sliding?.online ? "ONLINE" : "OFFLINE") : "STATUS"}</span>
          <div className={`system-status-cluster ${sliding?.online ? "is-ready" : "is-attention"}`}><i className="signal-dot" /><span><small>Controller status</small><strong>{!signedIn ? "Sign in for status" : sliding?.online ? "Reporting" : "No recent report"}</strong></span><b>{!signedIn ? "—/1" : sliding?.online ? "1/1" : "0/1"}</b></div>
          <span className="connection-pill"><i /> Encrypted connection</span>
          {signedIn && data?.viewer ? <div className="header-operator"><span><strong>{data.viewer.displayName}</strong><small>Resident</small></span><button type="button" className="macquarie-text-button" onClick={() => void signOut()}>Sign out</button></div> : <div className="header-operator"><span><strong>Not signed in</strong><small>Resident</small></span></div>}
        </div>
      </header>

      {!signedIn && <form className="macquarie-signin" onSubmit={signIn}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} placeholder="6-digit code" /></label>
        <button type="button" className={glassButton("orange")} disabled={busy} onClick={(event) => void askCode(event)}>Email me a code</button>
        <button type="submit" className={glassButton()} disabled={busy || code.trim().length !== 6}>Sign in</button>
      </form>}

      {notice && <p className="macquarie-note" role="status">{notice}</p>}
      {data?.linkNote && <p className="macquarie-note" role="status">{data.linkNote}</p>}
      {data?.usersNote && <p className="macquarie-note" role="status">{data.usersNote}</p>}

      <div className="campus-context">
        <section className={`campus-glass-calendar ${GLASS_PANEL} flex min-w-0 flex-col gap-4 p-5`} aria-labelledby="macquarie-schedule-title">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="macquarie-schedule-title" className="m-0 flex items-center gap-2 text-base font-bold"><CalendarDays className="size-5 text-[#5CC8FF]" aria-hidden="true" /> Gate Schedules</h2>
              <p className="m-0 mt-1 text-sm text-[#B9CFE2]">{dateLabel(start, { day: "numeric", month: "short" })} – {dateLabel(days[6], { day: "numeric", month: "short", year: "numeric" })}, Melbourne</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={glassButton()} aria-label="Previous week" onClick={() => { setStart(shiftDate(start, -7)); logClick("week-prev"); }}><ChevronLeft className="size-4" aria-hidden="true" /></button>
              <button type="button" className={glassButton()} onClick={() => { setStart(weekStart(today)); logClick("day-select", "Today"); }}>Today</button>
              <button type="button" className={glassButton()} aria-label="Next week" onClick={() => { setStart(shiftDate(start, 7)); logClick("week-next"); }}><ChevronRight className="size-4" aria-hidden="true" /></button>
              <button type="button" className={glassButton("orange")} disabled={!signedIn || busy} onClick={() => { setShowHold(true); logClick("hold-form"); }}>Hold open</button>
            </div>
          </header>
          <div className="-mx-1 flex flex-1 overflow-x-auto px-1 pb-1">
            <ol className="m-0 grid w-full min-w-[640px] list-none grid-cols-7 gap-2 p-0">
              {days.map((date) => {
                const weekday = weekdayNumber(date);
                const items = (data?.windows ?? []).filter((window) => window.enabled && window.days.includes(weekday));
                const isToday = date === today;
                return <li key={date}><button type="button" className={`${GLASS_TILE} ${GLASS_FOCUS} flex h-full min-h-[118px] w-full flex-col items-start gap-1 p-3 text-left ${isToday ? "border-[#FF7A00]" : ""} ${selected === date ? "border-[#5CC8FF]" : ""}`} aria-pressed={selected === date} aria-current={isToday ? "date" : undefined} onClick={() => { setSelected(selected === date ? null : date); logClick("day-select", date); }}>
                  <span className="text-xs font-bold uppercase tracking-wide text-[#B9CFE2]">{dateLabel(date, { weekday: "short" })}</span>
                  <strong className="text-2xl leading-none font-bold tabular-nums text-[#F5FBFF]">{Number(date.slice(-2))}</strong>
                  <span className="mt-auto text-xs text-[#8FB0CF]">{items.length ? items.slice(0, 2).map((item) => `${item.openTime} ${item.name}${item.spanDays > 0 ? ` +${item.spanDays} days` : ""}`).join(", ") : "No hold"}</span>
                </button></li>;
              })}
            </ol>
          </div>
          {selected && <div className={`${GLASS_TILE} p-4 text-sm text-[#F5FBFF]`}>
            <strong>{dateLabel(selected, { weekday: "long", day: "numeric", month: "long" })}</strong>
            <ul className="m-0 mt-2 list-none p-0">{(data?.windows ?? []).filter((window) => window.days.includes(weekdayNumber(selected))).map((window) => <li key={window.id}>{window.enabled ? "" : "Off · "}{window.openTime}–{window.closeTime} {window.name}{window.spanDays > 0 ? ` +${window.spanDays} days` : ""}</li>)}</ul>
            {(data?.windows ?? []).every((window) => !window.days.includes(weekdayNumber(selected))) && <p className="m-0 mt-2 text-[#8FB0CF]">No hold</p>}
          </div>}
        </section>
        <CampusWeather place="Thomastown, Victoria" endpoint="/api/macquarie/weather" onRefresh={() => logClick("weather")} />
      </div>

      <div className="workspace-content" data-view="macquarie">
        <section className="gate-condition mb-6" aria-label="Sliding gate">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="mb-1 text-[10px] font-semibold tracking-[.18em] uppercase">Access infrastructure</p><h2 className="m-0 text-lg">Active gate control</h2></div>
            <span className="flex items-center gap-2 text-xs"><Radio className="size-3.5" aria-hidden="true" /> 1 sliding gate</span>
          </div>
          <div className="gate-condition-grid">
            <article className="hardware-card group overflow-hidden rounded-2xl border" onClick={() => logClick("gate-card")}>
              <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                <div className="flex items-center gap-3"><span className="gate-ordinal grid size-9 place-items-center rounded-none border border-[#FF7A00] bg-[#FF7A00] text-xs font-bold text-white" aria-hidden="true">01</span><div><h3 className="m-0 text-sm font-semibold">{gate.name}</h3><p className="m-0 mt-1 text-[11px]">Sliding gate</p></div></div>
                <span className={`telemetry-badge tone-${sliding?.online ? "green" : "amber"}`}><i className="signal-dot" />{sliding?.online ? "Controller reporting" : "No recent report"}</span>
              </header>
              <div className="hardware-stage relative mx-3 mt-2">
                <GateTile gate={gate} position={position} motion={{ target: pictureTarget, label: pictureLabel }} interactive ariaLabel={ariaLabel} />
                <span className="hardware-view-label"><span className="size-1.5 rounded-full bg-[#5CC8FF]" /> 3D hardware view</span>
                <div className="quick-gate-controls" aria-label={`${gate.name} picture controls`}>
                  <button type="button" className={`quick-state-button quick-open ${pictureTarget === "open" ? "is-current" : ""}`} aria-label={`Show ${gate.name} open`} onClick={(event) => { event.stopPropagation(); setPicture("open"); logClick("gate-picture", "OPEN"); }}><span>OPEN</span></button>
                  <button type="button" className={`quick-state-button quick-closed ${pictureTarget === "closed" ? "is-current" : ""}`} aria-label={`Show ${gate.name} closed`} onClick={(event) => { event.stopPropagation(); setPicture("closed"); logClick("gate-picture", "CLOSE"); }}><span>CLOSE</span></button>
                </div>
                <aside className={`gate-current-state state-${position}`}>
                  <small>CURRENT STATE</small>
                  <strong><i aria-hidden="true" /><span>{sliding?.held ? "HELD OPEN" : "UNKNOWN"}</span></strong>
                  <span>Position</span><b>{pictureLabel}</b>
                  <span>Health</span><b>{sliding?.online ? "Reporting" : "No recent report"}</b>
                </aside>
                <div className="orbit-help"><span><MousePointer2 aria-hidden="true" /> Drag to rotate</span><span>Wheel to zoom</span><span>Right-drag to pan</span><span><RotateCcw aria-hidden="true" /> Double-click reset</span></div>
              </div>
              <div className="macquarie-metrics grid grid-cols-3 divide-x border-y py-4">
                <div className="metric-block px-4"><span><Thermometer aria-hidden="true" /> Pi temperature</span><strong>— </strong><p>No reading from the controller</p></div>
                <div className="metric-block px-4"><span><Activity aria-hidden="true" /> Heartbeat</span><strong>{age === null ? "—" : age > 3600 ? ">1h" : age}{age !== null && age <= 3600 ? <small>s</small> : null}</strong><p>{age === null ? "Awaiting heartbeat" : age <= 90 ? "Since last report" : "Stale feedback"}</p></div>
                <div className="metric-block px-4"><span><ShieldCheck aria-hidden="true" /> Safety input</span><strong className="!text-base !leading-8">Pending</strong><p>No position sensor</p></div>
              </div>
              <footer className="px-5 py-4 text-[11px]">OPEN and CLOSE move this picture the same way as the other gates. This gate has no position sensor. Hold open saves a hold time. It does not pulse the gate.</footer>
            </article>
          </div>
        </section>

        {showHold && <form className="macquarie-panel" onSubmit={(event) => { event.preventDefault(); void send("/api/macquarie", { action: "hold.save", name: holdName, openTime, closeTime, days: holdDays }); }}>
          <h2>Hold the sliding gate open</h2>
          <div className="macquarie-fields">
            <label>Name<input value={holdName} onChange={(event) => setHoldName(event.target.value)} required disabled={!canChange} /></label>
            <label>Opens<input type="time" value={openTime} onChange={(event) => setOpenTime(event.target.value)} required disabled={!canChange} /></label>
            <label>Closes<input type="time" value={closeTime} onChange={(event) => setCloseTime(event.target.value)} required disabled={!canChange} /></label>
          </div>
          <fieldset className="macquarie-days"><legend>Days</legend>{DAY_NAMES.map((name, index) => <label key={name}><input type="checkbox" checked={holdDays.includes(index + 1)} disabled={!canChange} onChange={(event) => setHoldDays((current) => event.target.checked ? [...current, index + 1].sort() : current.filter((day) => day !== index + 1))} />{name}</label>)}</fieldset>
          <button type="submit" className={glassButton("orange")} disabled={!canChange || holdDays.length === 0}>Save window</button>
          <ul className="macquarie-list">{(data?.windows ?? []).map((window) => <li key={window.id}><span>{window.enabled ? "" : "Off · "}{window.name} {window.openTime}–{window.closeTime} {window.days.map((day) => DAY_NAMES[day - 1]).join(" ")}{window.spanDays > 0 ? ` +${window.spanDays} days` : ""}</span><button type="button" disabled={!canChange} onClick={() => void send("/api/macquarie", { action: "hold.delete", id: window.id })}>Remove</button></li>)}</ul>
        </form>}

        <section className="macquarie-panel" aria-labelledby="macquarie-users-title">
          <header className="macquarie-panel-head"><h2 id="macquarie-users-title">People</h2><button type="button" className={glassButton()} onClick={() => logClick("users-form")}>User form</button></header>
          <p>Add or remove people who can dial the sliding gate, and people who can sign in to this page.</p>
          <div className="macquarie-split">
            <form onSubmit={(event) => { event.preventDefault(); void send("/api/macquarie", { action: "caller.add", name: callerName, phone: callerPhone }).then((payload) => { if (payload?.signedIn) { setCallerName(""); setCallerPhone(""); } }); }}>
              <h3>Gate callers</h3>
              {signedIn && data?.callersWritable === false && <p>Caller numbers stay with RJL while another gate shares this site.</p>}
              <label>Name<input value={callerName} onChange={(event) => setCallerName(event.target.value)} disabled={!canChange || !data?.callersWritable} required /></label>
              <label>Mobile<input value={callerPhone} onChange={(event) => setCallerPhone(event.target.value)} inputMode="tel" autoComplete="tel" disabled={!canChange || !data?.callersWritable} required /></label>
              <button type="submit" className={glassButton("orange")} disabled={!canChange || !data?.callersWritable}>Add caller</button>
              <ul className="macquarie-list">{(data?.callers ?? []).map((caller) => <li key={caller.id}><span>{caller.name} · {caller.phone}{caller.enabled ? "" : " · off"}</span>{data?.callersWritable && <button type="button" disabled={!canChange} onClick={() => { if (window.confirm(`Remove ${caller.name} from the gate callers?`)) void send("/api/macquarie", { action: "caller.delete", id: caller.id }); }}>Remove</button>}</li>)}</ul>
            </form>
            <form onSubmit={(event) => { event.preventDefault(); void send("/api/macquarie", { action: "portal-user.add", name: personName, email: personEmail }).then((payload) => { if (payload?.signedIn) { setPersonName(""); setPersonEmail(""); } }); }}>
              <h3>Portal sign-in</h3>
              <label>Name<input value={personName} onChange={(event) => setPersonName(event.target.value)} disabled={!signedIn || busy || Boolean(data?.usersNote)} required /></label>
              <label>Email<input type="email" value={personEmail} onChange={(event) => setPersonEmail(event.target.value)} disabled={!signedIn || busy || Boolean(data?.usersNote)} required /></label>
              <button type="submit" className={glassButton("orange")} disabled={!signedIn || busy || Boolean(data?.usersNote)}>Add sign-in</button>
              <ul className="macquarie-list">{(data?.portalUsers ?? []).map((person) => <li key={person.email}><span>{person.displayName} · {person.email}{person.kept ? " · kept by RJL" : ""}</span>{!person.kept && <button type="button" disabled={!signedIn || busy} onClick={() => { if (!window.confirm(`Remove ${person.email} from sign-in?`)) return; const own = person.email.toLowerCase() === data?.viewer?.email.toLowerCase(); void send("/api/macquarie", { action: "portal-user.delete", email: person.email }).then((payload) => { if (own && payload?.signedIn) void signOut(); }); }}>Remove</button>}</li>)}</ul>
            </form>
          </div>
        </section>

        <div className="macquarie-info">
          <details id="fire-info" className="macquarie-panel">
            <summary onClick={() => logClick("info-fire")}>About fire evacuation</summary>
            <p>Fire evacuation is a separate safety path. This page does not start a fire alarm and it does not open the gate for an emergency. On a real fire, follow the site evacuation plan and the instructions of the person in charge.</p>
            <p>Magic Keys can show a fire-evacuation control to an authorised administrator on the operations portal. Ask RJL if you want that explained for Macquarie Drive.</p>
          </details>
          <details id="ai-info" className="macquarie-panel">
            <summary onClick={() => logClick("info-ai")}>About the Magic Keys assistant</summary>
            <p>Magic Keys can add an assistant that answers questions about hold-open times, caller numbers, and how the sliding gate is set up. The note on this page is information only.</p>
            <p>An assistant here would not open the gate, change a schedule, or add a person. Ask RJL about adding one to this portal.</p>
          </details>
        </div>
      </div>
    </div>
  </div>;
}
