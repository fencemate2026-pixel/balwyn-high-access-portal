"use client";
// Owner → RJL portals → Mildura (4 Nov 2026, Jarrod): the same sections as the
// Mildura Pi's own dashboard, in the Pi's order, restyled with the portal theme.
// Data is the Pi's mirror (gd_mirror_*) read server-side by the owner-gated
// /api/owner/sites?view=mirror. The cloud holds no PINs, so none are shown.
// Phase 2: changes are queued through /api/owner/mildura (mildura-controls.tsx) and
// applied by the Pi; Open/Hold/Lockdown stay disabled until the gate app is understood.
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { CommandList, CommandPill, ControlBar, MilduraControlProvider, PersonForm, ScheduleForm, UserForm, useMilduraControl, type ControlState } from "./mildura-controls";
import { Activity, CalendarClock, ClipboardList, Cpu, Gauge, HardDrive, LoaderCircle, MapPin, MemoryStick, PieChart, Search, ShieldCheck, Thermometer, Timer, UserCheck, Users } from "lucide-react";
import { GLASS_PANEL, GLASS_TILE, glassButton } from "./glass-ui";
import { UNIT_ONLINE_SECONDS } from "@/lib/owner-sites-model";
import { MILDURA_ADDRESS, accessBreakdown, gateStatus, healthTiles, usageByDay, type MirrorAccess, type MirrorStatus } from "@/lib/mildura-view-model";

type MUser = { local_id: number; name: string; enabled: boolean; schedule_type: string | null; schedule_data: unknown; created_at_local: string | null };
type MSchedule = { local_id: number; name: string; days: unknown; open_time: string; close_time: string; enabled: boolean };
type MPerson = { local_id: number; name: string; role: string | null };
type MChange = { local_id: number; occurred_at_local: string; action: string; detail: string | null; changed_by: string | null };
export type MirrorDetail = {
  site: { id: string; slug: string; name: string };
  units: { id: string; name: string; last_seen: string | null; last_status: MirrorStatus; fw_version: string | null }[];
  users: MUser[]; schedules: MSchedule[]; persons: MPerson[]; access: MirrorAccess[]; access30: MirrorAccess[]; changes: MChange[];
  serverTime: string;
};

const SITE_NAME = "Mildura Working Men's Club";
const TZ = "Australia/Melbourne";
const DAYN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const local = (ts: string | null) => ts ? String(ts).replace("T", " ").slice(0, 16) : "—";
const ago = (ts: string | null, now: number) => {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const days = (d: unknown) => {
  const list = Array.isArray(d) ? d : typeof d === "string" ? d.split(/[,\s]+/).filter(Boolean) : [];
  return list.map((x) => typeof x === "number" ? DAYN[x] ?? String(x) : String(x)).join(" ") || "—";
};

// Magic Keys theme (4 Nov 2026): the same building blocks the main dashboard uses —
// GLASS_PANEL navy gradient cards, the white "Active gate controls" header strip
// (.gate-condition) with an orange title, orange gate-ordinal badges, metric-block
// strips, telemetry-badge / connection-pill pills. Utility classes only, no new CSS.
const MUTED = "text-[#B9CFE2]";
type Tone = "ok" | "bad" | "warn" | "mute";
const TONE: Record<Tone, string> = { ok: "text-[#34d399]", bad: "text-[#ff6b6b]", warn: "text-[#fbbf24]", mute: "text-[#B9CFE2]" };
const Pill = ({ tone, children, caps = false }: { tone: Tone; children: React.ReactNode; caps?: boolean }) =>
  <em className={`telemetry-badge not-italic ${TONE[tone]} ${caps ? "text-[10px] font-bold tracking-[.08em] uppercase" : ""}`}><i className="signal-dot" />{children}</em>;
const TH = `px-3 py-2 text-left text-[11px] font-semibold tracking-[.08em] uppercase ${MUTED} border-b border-white/[0.14]`;
const TD = "px-3 py-2 border-b border-white/[0.08] text-sm";
// Cell text sits in a <span> so the dashboard's navy-panel text rule (.campus-context .mk-navy span) colours it.
const Td = ({ children, className = "", colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) =>
  <td className={`${TD} ${className}`} colSpan={colSpan}><span>{children}</span></td>;
/** The dashboard styles its navy panels inside .campus-context (Gate Schedules / Local weather);
 *  wrapping each panel the same way reuses those exact rules. Inline style only drops its grid layout. */
const NAVY_SCOPE: React.CSSProperties = { display: "block", padding: 0, background: "transparent", maxWidth: "none" };
const Navy = ({ children, className = "" }: { children: React.ReactNode; className?: string }) =>
  <div className="campus-context" style={NAVY_SCOPE}><div className={`${GLASS_PANEL} p-4 ${className}`}>{children}</div></div>;

/** Section = white header strip with orange title + icon (as "Active gate controls"), then a navy glass card. */
function Section({ n, icon: Icon, title, right, children, label }: { n: number; icon: typeof Activity; title: string; right?: React.ReactNode; children: React.ReactNode; label?: string }) {
  return <section className="gate-condition mb-4" aria-label={label ?? title}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="gate-ordinal grid size-7 place-items-center rounded-none border border-[#FF7A00] bg-[#FF7A00] text-[11px] font-bold text-white" aria-hidden="true">{String(n).padStart(2, "0")}</span>
        <h2 className="m-0 flex items-center gap-2 text-lg"><Icon className="size-4 text-[#FF7A00]" aria-hidden="true" /> {title}</h2></div>
      {right}
    </div>
    <Navy>{children}</Navy>
  </section>;
}
const Empty = ({ text = "Waiting for first sync from the Mildura Pi." }: { text?: string }) => <p className={`m-0 text-sm ${MUTED}`}>{text}</p>;

export default function MilduraSiteView({ fixture, controlFixture }: { fixture?: MirrorDetail; controlFixture?: ControlState } = {}) {
  const [data, setData] = useState<MirrorDetail | null>(fixture ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/owner/sites?site=mildura&view=mirror", { credentials: "same-origin", cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? "Site data is not available right now.");
        if (!cancelled) { setData(body as MirrorDetail); setError(""); }
      } catch (e) { if (!cancelled) setError((e as Error).message); }
    };
    const kick = setTimeout(load, 0); const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearTimeout(kick); clearInterval(timer); };
  }, [fixture]);

  if (!data) return error ? <div className={`${GLASS_PANEL} p-4 text-sm`}><Pill tone="bad">{error}</Pill></div> : <div className="flex items-center gap-2"><LoaderCircle className="animate-spin" /> Loading Mildura…</div>;
  return <MilduraControlProvider fixture={controlFixture}><MilduraBody data={data} /></MilduraControlProvider>;
}

const HEALTH_ICON = { temp: Thermometer, cpu: Cpu, mem: MemoryStick, disk: HardDrive, uptime: Timer } as const;

function MilduraBody({ data }: { data: MirrorDetail }) {
  const now = Date.parse(data.serverTime) || Date.now();
  const unit = data.units[0] ?? null;
  const on = !!unit?.last_seen && (now - Date.parse(unit.last_seen)) / 1000 < UNIT_ONLINE_SECONDS;
  const gate = gateStatus(unit?.last_status ?? null);
  const empty = !unit?.last_seen && !data.users.length && !data.access.length && !data.schedules.length && !data.persons.length;
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
  const usage = useMemo(() => usageByDay(data.access30, today), [data.access30, today]);
  const max = Math.max(1, ...usage.map((b) => b.count));
  const total = usage.reduce((a, b) => a + b.count, 0);
  const breakdown = useMemo(() => accessBreakdown(data.access30), [data.access30]);
  const [tab, setTab] = useState<"access" | "changes">("access");
  const [q, setQ] = useState("");
  const users = data.users.filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  const lastSeen = ago(unit?.last_seen ?? null, now);
  const ctl = useMilduraControl();
  const can = !!ctl?.state?.unlocked && !ctl.busy;
  const [form, setForm] = useState<null | "user" | "schedule" | "person" | { edit: number }>(null);
  const editing = form && typeof form === "object" ? data.users.find((u) => u.local_id === form.edit) : undefined;
  const lock = can ? undefined : "Unlock changes first";

  return (
    <div className="mildura-view">
      {/* 1. Header and gate status */}
      <section className="gate-condition mb-4" aria-label="Mildura gate status">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2 text-lg"><ShieldCheck className="size-4 text-[#FF7A00]" aria-hidden="true" /> {SITE_NAME}</h2>
          <span className="connection-pill"><i /> Owner control · via Pi command queue</span>
        </div>
        <Navy>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="gate-ordinal grid size-9 place-items-center rounded-none border border-[#FF7A00] bg-[#FF7A00] text-xs font-bold text-white" aria-hidden="true">01</span>
              <div><h3 className="m-0 text-sm font-semibold">Boom gate</h3><p className={`m-0 mt-1 text-[11px] ${MUTED}`}>Keypad · auto-open · {unit?.fw_version ?? "mirror"}</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone={on ? "ok" : "bad"}>{on ? "Online" : "Offline"} · last seen {lastSeen}</Pill>
              <Pill tone={gate.tone}>Gate: {gate.label}</Pill>
            </div>
          </div>
          <ControlBar />
          {empty && <div className={`${GLASS_TILE} mt-4 p-3 text-sm`}><strong className="text-[#FF7A00]">Waiting for first sync from the Mildura Pi.</strong> <span className={MUTED}>Nothing has been received yet.</span></div>}
        </Navy>
      </section>

      {/* 2. Authorised persons */}
      <Section n={2} icon={UserCheck} title="Authorised persons" right={<button type="button" className={glassButton("orange")} disabled={!can} title={lock} onClick={() => setForm("person")}><Plus className="size-4" /> Add person</button>}>
        {form === "person" && <PersonForm onDone={() => setForm(null)} />}
        {data.persons.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.persons.map((p) =>
          <div key={p.local_id} className={`${GLASS_TILE} flex items-start justify-between gap-2 p-3`}><div><strong className="block text-sm">{p.name}</strong><small className={MUTED}>{p.role ?? "—"}</small> <CommandPill c={ctl?.openFor("person", p.local_id) ?? null} /></div>
            <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${p.name}`} disabled={!can} title={lock}
              onClick={() => ctl?.send({ kind: "person.delete", local_id: p.local_id }, { title: `Delete ${p.name}?`, body: "They are removed from the Mildura Pi's authorised persons list.", action: "Delete person" })}><Trash2 className="size-4" /></button></div>)}</div> : <Empty />}
      </Section>

      {/* 3. Pi health: the dashboard's metric strip */}
      <Section n={3} icon={Activity} title="Pi health" label="Pi health">
        <div className="grid grid-cols-2 divide-white/[0.14] md:grid-cols-5 md:divide-x">
          {healthTiles(unit?.last_status ?? null).map((t) => { const I = HEALTH_ICON[t.key as keyof typeof HEALTH_ICON]; return (
            <div key={t.key} className="metric-block px-4 py-1">
              <span className={MUTED}><I /> {t.label}</span>
              <strong className="text-[#F5FBFF]">{t.value ?? "—"}</strong>
              <p className={MUTED}>{t.value ? "From the site Pi" : "not reported"}</p>
            </div>); })}
        </div>
      </Section>

      {/* 4. Keypad usage */}
      <Section n={4} icon={Gauge} title="Keypad usage" right={<span className="flex items-center gap-2 text-xs text-muted-foreground">Last 30 days · {total} uses</span>}>
        <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Keypad uses per day, total ${total}`}>
          {usage.map((b) => <div key={b.day} className="min-h-[2px] flex-1 bg-[#FF7A00] shadow-[0_0_8px_rgba(255,122,0,0.45)]" style={{ height: `${(b.count / max) * 100}%` }} title={`${b.day}: ${b.count}`} />)}
        </div>
        <div className={`mt-1 flex justify-between text-[11px] ${MUTED}`}><span>{usage[0].day}</span><span>{usage[usage.length - 1].day}</span></div>
      </Section>

      {/* 5. Site location */}
      <Section n={5} icon={MapPin} title="Site location" label="Site location">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm">{SITE_NAME}<br /><span className={MUTED}>{MILDURA_ADDRESS}</span></p>
          <a className={glassButton()} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE_NAME}, ${MILDURA_ADDRESS}`)}`} target="_blank" rel="noopener noreferrer"><MapPin className="size-4" aria-hidden="true" /> Open in Google Maps</a>
        </div>
      </Section>

      {/* 6. Auto-open schedules */}
      <Section n={6} icon={CalendarClock} title="Auto-open schedules" right={<button type="button" className={glassButton("orange")} disabled={!can} title={lock} onClick={() => setForm("schedule")}><Plus className="size-4" /> Add schedule</button>}>
        {form === "schedule" && <ScheduleForm onDone={() => setForm(null)} />}
        <p className={`m-0 mb-3 text-xs ${MUTED}`}>Note: in the gate app source (Sep 2026) the on-site time clock owns opening hours and the app ignores these schedules; they take effect only if the Pi&apos;s newer build uses them again.</p>
        {data.schedules.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.schedules.map((s) =>
          <div key={s.local_id} className={`${GLASS_TILE} p-3 ${s.enabled ? "border-[#FF7A00] bg-[#FF7A00]/[0.12]" : ""}`}>
            <div className="flex items-center justify-between gap-2"><strong className="text-sm">{s.name}</strong><Pill tone={s.enabled ? "ok" : "mute"} caps>{s.enabled ? "Active" : "Off"}</Pill></div>
            <p className="m-0 mt-2 text-xl font-bold tabular-nums">{String(s.open_time).slice(0, 5)} – {String(s.close_time).slice(0, 5)}</p>
            <small className={MUTED}>{days(s.days)}</small>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className={`${glassButton()} h-8`} disabled={!can} title={lock} onClick={() => ctl?.send({ kind: "schedule.enable", local_id: s.local_id, enabled: !s.enabled }, s.enabled ? { title: `Turn off "${s.name}"?`, body: "The gate will stop opening automatically for this schedule.", action: "Turn off" } : undefined)}><Power className="size-4" /> <span>{s.enabled ? "Disable" : "Enable"}</span></button>
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${s.name}`} disabled={!can} title={lock} onClick={() => ctl?.send({ kind: "schedule.delete", local_id: s.local_id }, { title: `Delete "${s.name}"?`, body: "This auto-open schedule is removed from the Pi.", action: "Delete schedule" })}><Trash2 className="size-4" /></button>
              <CommandPill c={ctl?.openFor("schedule", s.local_id) ?? null} />
            </div>
          </div>)}</div> : <Empty />}
      </Section>

      {/* 7. Access breakdown */}
      <Section n={7} icon={PieChart} title="Access breakdown" right={<span className="text-xs text-muted-foreground">Last 30 days</span>}>
        <Donut parts={[["Granted", breakdown.granted, "#34d399"], ["Denied", breakdown.denied, "#ff6b6b"], ["Auto-open", breakdown.autoOpen, "#FF7A00"]]} />
      </Section>

      {/* 8. Authorised users */}
      <Section n={8} icon={Users} title="Authorised users" label="Authorised users" right={<div className="flex flex-wrap items-center gap-2">
        <span className="connection-pill"><i /> {data.users.length} users</span>
        <label className={`${GLASS_PANEL} flex h-9 items-center gap-2 px-3`}><Search className="size-4 text-[#5CC8FF]" aria-hidden="true" />
          <input className="w-44 bg-transparent text-sm text-[#F5FBFF] outline-none placeholder:text-[#B9CFE2]" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></label>
        <button type="button" className={glassButton()} disabled={!can} title={lock} onClick={() => ctl?.send({ kind: "users.enable_all", enabled: true }, { title: "Enable ALL users?", body: `Every one of the ${data.users.length} users' PINs will open the gate again.`, action: "Enable all" })}>Enable all</button>
        <button type="button" className={glassButton()} disabled={!can} title={lock} onClick={() => ctl?.send({ kind: "users.enable_all", enabled: false }, { title: "Disable ALL users?", body: `No user PIN will open the Mildura gate until re-enabled (${data.users.length} users).`, action: "Disable all" })}>Disable all</button>
        <button type="button" className={glassButton("orange")} disabled={!can || !ctl?.state?.keyRegistered} title={lock ?? (ctl?.state?.keyRegistered ? undefined : "Pi command key not registered")} onClick={() => setForm("user")}><Plus className="size-4" /> Add User</button>
      </div>}>
        {(form === "user" || editing) && <UserForm key={editing?.local_id ?? "new"} user={editing} users={data.users} onDone={() => setForm(null)} />}
        <div className="max-h-[440px] overflow-auto"><table className="w-full border-collapse">
          <thead><tr><th className={TH}>Name</th><th className={TH}>Status</th><th className={TH}>Schedule</th><th className={TH}>Added</th><th className={TH}>Actions</th></tr></thead>
          <tbody>{users.length ? users.map((u) => <tr key={u.local_id}><Td>{u.name}</Td>
            <Td><Pill tone={u.enabled ? "ok" : "bad"} caps>{u.enabled ? "Enabled" : "Disabled"}</Pill></Td>
            <Td><Pill tone={!u.schedule_type || u.schedule_type === "always" ? "mute" : "warn"} caps>{u.schedule_type ? u.schedule_type.replace(/_/g, " ") : "always"}</Pill></Td>
            <Td className={MUTED}>{local(u.created_at_local)}</Td>
            <td className={TD}><div className="flex items-center gap-1">
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Edit ${u.name}`} disabled={!can} title={lock} onClick={() => setForm({ edit: u.local_id })}><Pencil className="size-4" /></button>
              <button type="button" className={`${glassButton()} h-8`} disabled={!can} title={lock} onClick={() => ctl?.send({ kind: "user.enable", local_id: u.local_id, enabled: !u.enabled }, u.enabled ? { title: `Disable ${u.name}?`, body: "Their PIN will stop opening the gate until re-enabled.", action: "Disable" } : undefined)}><span>{u.enabled ? "Disable" : "Enable"}</span></button>
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${u.name}`} disabled={!can} title={lock} onClick={() => ctl?.send({ kind: "user.delete", local_id: u.local_id }, { title: `Delete ${u.name}?`, body: "The user and their PIN are removed from the Mildura Pi. This cannot be undone from the portal.", action: "Delete user" })}><Trash2 className="size-4" /></button>
              <CommandPill c={ctl?.openFor("user", u.local_id) ?? null} />
            </div></td></tr>)
            : <tr><Td colSpan={5}><Empty text={data.users.length ? "No user matches that search." : undefined} /></Td></tr>}</tbody>
        </table></div>
      </Section>

      {/* 9. Commands sent to the Pi (Phase 2) */}
      <Section n={9} icon={ClipboardList} title="Commands sent to the Pi" label="Commands" right={<span className="text-xs text-muted-foreground">Pending → Applied / Failed, as reported by the Pi</span>}>
        <CommandList />
      </Section>

      {/* 10. Access log / Changes log */}
      <Section n={10} icon={ClipboardList} title={tab === "access" ? "Access log" : "Changes log"} label="Logs" right={<div className="flex gap-2" role="tablist">
        {([["access", "Access log"], ["changes", "Changes log"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={glassButton(tab === k ? "orange" : "glass")} onClick={() => setTab(k)}>{l}</button>)}
      </div>}>
        <div className="max-h-[520px] overflow-auto">{tab === "access" ? <table className="w-full border-collapse">
          <thead><tr><th className={TH}>Time (site)</th><th className={TH}>User</th><th className={TH}>Method</th><th className={TH}>Result</th></tr></thead>
          <tbody>{data.access.length ? data.access.map((a, i) => <tr key={a.local_id ?? i}><Td className="tabular-nums">{local(a.occurred_at_local)}</Td><Td>{a.user_name ?? "Unknown"}</Td><Td className={MUTED}>{a.method ?? ""}</Td>
            <Td><Pill tone={a.success ? "ok" : "bad"} caps>{a.success ? "Granted" : "Denied"}</Pill></Td></tr>)
            : <tr><Td colSpan={4}><Empty /></Td></tr>}</tbody></table>
        : <table className="w-full border-collapse">
          <thead><tr><th className={TH}>Time (site)</th><th className={TH}>Action</th><th className={TH}>Detail</th><th className={TH}>By</th></tr></thead>
          <tbody>{data.changes.length ? data.changes.map((c) => <tr key={c.local_id}><Td className="tabular-nums">{local(c.occurred_at_local)}</Td><Td>{c.action}</Td><Td>{c.detail ?? ""}</Td><Td className={MUTED}>{c.changed_by ?? ""}</Td></tr>)
            : <tr><Td colSpan={4}><Empty /></Td></tr>}</tbody></table>}</div>
      </Section>
    </div>
  );
}

function Donut({ parts }: { parts: [string, number, string][] }) {
  const total = parts.reduce((a, p) => a + p[1], 0);
  const r = 42, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="132" height="132" viewBox="0 0 120 120" role="img" aria-label={parts.map((p) => `${p[0]} ${p[1]}`).join(", ")}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="14" />
        {total > 0 && parts.map(([l, v, col]) => { const len = (v / total) * c; const el = <circle key={l} cx="60" cy="60" r={r} fill="none" stroke={col} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />; off += len; return el; })}
        <text x="60" y="66" textAnchor="middle" fontSize="18" fontWeight="700" fill="#F5FBFF">{total}</text>
      </svg>
      <div className="grid gap-2 sm:grid-cols-3">{parts.map(([l, v, col]) => <div key={l} className={`${GLASS_TILE} min-w-32 p-3`}><small className={`flex items-center gap-2 ${MUTED}`}><i className="inline-block size-2.5" style={{ background: col }} />{l}</small><strong className="text-xl tabular-nums">{v}</strong></div>)}</div>
    </div>
  );
}
