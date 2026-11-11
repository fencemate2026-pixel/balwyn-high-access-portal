"use client";
// Owner → Thomastown swing gate (6 Nov 2026, Jarrod): every caller, every call and every change from
// the Magic Keys portal, stored in Azure. The gate's Pi keeps the authoritative list; this screen reads
// its mirror and QUEUES changes, which the Pi applies and confirms (Pending → Applied / Failed).
// No PIN or unlock step for the owner. No "delete all": every delete asks first. Owner-only: the API
// answers 404 to anyone else, so hiding this component is presentation, not security.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardList, Clock3, DoorOpen, Download, History, LoaderCircle, Pencil, Phone, Plus, Search, ShieldCheck, Trash2, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, DayPicker, FIELD_STYLE, INPUT, type ConfirmSpec } from "./mildura-controls";
import { GLASS_PANEL, GLASS_TILE, glassButton } from "./glass-ui";
import { MUTED, Pill, Section, TD, TH, Td, downloadCsv, stampDay } from "./site-section-ui";
import { toCsv } from "@/lib/owner-csv";
import { deviceClientHref } from "@/lib/client-portal";
import { GD_SITES, SWING_DEVICE_ID, callResult, displayPhone, gdDialIn, simInfo, type GdSiteId } from "@/lib/gd-swing-model";

type SUser = { local_id: number; name: string; phone: string; enabled: boolean; schedule_type: string | null; schedule_data: string | null; created_at_local: string | null };
type SHold = { local_id: number; name: string; days: number[]; open_time: string; close_time: string; enabled: boolean };
type SAccess = { local_id: number; occurred_at_local: string | null; user_name: string | null; method: string | null; success: boolean | null };
type SChange = { local_id: number; occurred_at_local: string | null; action: string | null; detail: string | null; changed_by: string | null; source: string };
type SCommand = { id: string; seq: number; kind: string; args: Record<string, unknown>; status: "pending" | "delivered" | "applied" | "failed" | "expired"; actor_email: string; error: string | null; created_at: string };
export type SwingDetail = {
  device: { last_seen: string | null; fw_version: string | null; last_status: Record<string, unknown> | null } | null;
  users: SUser[]; holds?: SHold[]; holdsReady?: boolean; access: SAccess[]; changes: SChange[]; commands: SCommand[]; online: boolean; serverTime: string;
};
type Send = (body: Record<string, unknown>, ask?: ConfirmSpec) => Promise<boolean>;

const DAYN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const local = (ts: string | null) => (ts ? String(ts).replace("T", " ").slice(0, 16) : "—");
const looksLikeNumber = (s: string | null) => !!s && /^\+?\d[\d ]{4,}$/.test(s);
const ago = (ts: string | null, now: number) => {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
function scheduleText(u: Pick<SUser, "schedule_type" | "schedule_data">) {
  if (u.schedule_type !== "time_range") return "Always";
  try { const d = JSON.parse(String(u.schedule_data)) as { days?: number[]; start?: string; end?: string }; return `${(d.days ?? []).map((x) => DAYN[x]).join(" ")} ${d.start}–${d.end}`; } catch { return "Set hours"; }
}
const STATUS: Record<SCommand["status"], [string, string, typeof Clock3]> = {
  pending: ["Pending", "text-[#fbbf24]", Clock3], delivered: ["Applying", "text-[#fbbf24]", LoaderCircle],
  applied: ["Applied", "text-[#34d399]", CheckCircle2], failed: ["Failed", "text-[#ff6b6b]", XCircle], expired: ["Expired", "text-[#ff6b6b]", XCircle],
};
function CmdPill({ c }: { c: SCommand | null | undefined }) {
  if (!c) return null;
  const [label, tone, Icon] = STATUS[c.status];
  return <em className={`telemetry-badge not-italic text-[10px] font-bold uppercase tracking-[.08em] ${tone}`} title={c.error ?? undefined}><Icon className={`size-3 ${c.status === "delivered" ? "animate-spin" : ""}`} />{label}</em>;
}

async function call<T>(device: GdSiteId, init?: { body: Record<string, unknown> }): Promise<T> {
  const res = await fetch(`/api/owner/${device}`, init
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body), credentials: "same-origin" }
    : { credentials: "same-origin", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed.");
  return data as T;
}

// One screen for every Azure-backed Thomastown gate (swing, sliding): `device` picks the site and its API.
export default function ThomastownSwingView({ fixture, device = SWING_DEVICE_ID, title, clientHref }: { fixture?: SwingDetail; device?: GdSiteId; title?: string; clientHref?: string | null } = {}) {
  const [data, setData] = useState<SwingDetail | null>(fixture ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<(ConfirmSpec & { resolve: (ok: boolean) => void }) | null>(null);

  const siteName = title || GD_SITES[device].name;
  const load = useCallback(async () => {
    try { setData(await call<SwingDetail>(device)); setError(""); } catch (e) { setError((e as Error).message); }
  }, [device]);
  useEffect(() => {
    if (fixture) return;
    const run = () => { if (!document.hidden) void load(); };
    const kick = setTimeout(run, 0); const timer = setInterval(run, 10_000);
    return () => { clearTimeout(kick); clearInterval(timer); };
  }, [fixture, load]);

  const send: Send = useCallback(async (body, ask) => {
    if (ask && !(await new Promise<boolean>((resolve) => setConfirm({ ...ask, resolve })))) return false;
    setBusy(true);
    try {
      const out = await call<{ duplicate?: boolean }>(device, { body: { ...body, clientKey: crypto.randomUUID() } });
      toast.success(out.duplicate ? "Already queued." : `Queued for ${siteName}. Wait for Applied.`);
      await load(); return true;
    } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  }, [device, load, siteName]);

  if (!data) return error ? <div className={`${GLASS_PANEL} p-4 text-sm`}><Pill tone="bad">{error}</Pill></div> : <div className="flex items-center gap-2"><LoaderCircle className="animate-spin" /> Loading {siteName}…</div>;
  const pageHref = clientHref === undefined ? deviceClientHref(device) : clientHref;
  return <><Body data={data} busy={busy} send={send} siteName={siteName} dialIn={gdDialIn(device)} pulseGate={device === SWING_DEVICE_ID} clientHref={pageHref} />{confirm && <ConfirmDialog spec={confirm} onClose={(ok) => { confirm.resolve(ok); setConfirm(null); }} />}</>;
}

function commandLabel(c: SCommand) {
  if (c.kind === "gate.pulse") return "Open pulse";
  return `${c.kind}${c.args.name ? ` · ${String(c.args.name)}` : ""}${c.args.local_id ? ` · #${String(c.args.local_id)}` : ""}`;
}

function Body({ data, busy, send, siteName, dialIn, pulseGate, clientHref }: { data: SwingDetail; busy: boolean; send: Send; siteName: string; dialIn: string | null; pulseGate: boolean; clientHref: string | null }) {
  const now = Date.parse(data.serverTime) || Date.now();
  const seen = data.device?.last_seen ?? null;
  const [tab, setTab] = useState<"calls" | "changes">("calls");
  const [q, setQ] = useState(""); const [status, setStatus] = useState<"all" | "on" | "off">("all");
  const [cq, setCq] = useState(""); const [cres, setCres] = useState<"all" | "opened" | "refused">("all");
  const [form, setForm] = useState<null | "add" | { edit: number }>(null);
  const editing = form && typeof form === "object" ? data.users.find((u) => u.local_id === form.edit) : undefined;
  const open = useMemo(() => { const m = new Map<number, SCommand>(); for (const c of [...data.commands].reverse()) { const id = Number(c.args.local_id); if (id && !c.kind.startsWith("hold.")) m.set(id, c); } return m; }, [data.commands]);
  const users = data.users.filter((u) => (u.name + u.phone).toLowerCase().includes(q.trim().toLowerCase()) && (status === "all" || (status === "on") === u.enabled));
  const calls = data.access.filter((a) => {
    const r = callResult(a.method, a.success);
    return (cres === "all" || (cres === "opened") === (r.label === "Opened")) && `${a.user_name ?? ""}`.toLowerCase().includes(cq.trim().toLowerCase().replace(/\s/g, ""));
  });
  const nameFor = (a: SAccess) => looksLikeNumber(a.user_name) ? "Not on the list" : a.user_name ?? "Unknown";
  const numFor = (a: SAccess) => looksLikeNumber(a.user_name) ? displayPhone(a.user_name!.replace(/^\+61/, "0").replace(/\s/g, "")) : "On the list";
  const lock = busy ? "Working…" : undefined;
  const sim = simInfo(data.device?.last_status);
  const simCmd = useMemo(() => data.commands.find((c) => c.kind === "sim.number"), [data.commands]);
  const pulseCmd = useMemo(() => data.commands.find((c) => c.kind === "gate.pulse"), [data.commands]);

  return (
    <div className="mildura-view">
      <section className="gate-condition mb-4" aria-label={`${siteName} status`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2 text-lg"><ShieldCheck className="size-4 text-[#FF7A00]" aria-hidden="true" /> {siteName}</h2>
          {clientHref && <a className={glassButton()} href={clientHref} title="Opens this site's page on this portal">Client page</a>}
          <span className="connection-pill"><i /> Owner control · Azure · applied by the site Pi</span>
          {pulseGate && <button type="button" className={glassButton("orange")} disabled={busy} title={lock} onClick={() => send({ kind: "gate.pulse" }, { title: "Open the gate?", body: "This queues one pulse, the same pulse an allowed phone call sends. The unit applies it on its next check-in. It does not place a phone call. It does not close the gate. Pressing again sends that same pulse again.", action: "Queue open pulse" })}><DoorOpen className="size-4" /> Open</button>}
          {pulseGate && <CmdPill c={pulseCmd} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={data.online ? "ok" : "bad"}>{data.online ? "Online" : "Offline"} · last seen {ago(seen, now)}</Pill>
          <Pill tone="mute">{data.users.length} callers · {data.users.filter((u) => u.enabled).length} enabled</Pill>
          {sim.state === "ok" && <Pill tone="ok"><Phone className="mr-1 inline size-3" aria-hidden="true" />Dial-in number {displayPhone(sim.number)}</Pill>}
          {sim.state === "unsupported" && dialIn && <Pill tone="ok"><Phone className="mr-1 inline size-3" aria-hidden="true" />Dial-in number {displayPhone(dialIn)}</Pill>}
          {sim.state === "unsupported" && !dialIn && <Pill tone="mute"><Phone className="mr-1 inline size-3" aria-hidden="true" />Dial-in number not entered yet</Pill>}
          {sim.state === "nosim" && <Pill tone="bad">No SIM detected in the unit</Pill>}
          {sim.state === "unread" && <Pill tone="mute">Reading the SIM…</Pill>}
          {data.device?.fw_version && <Pill tone="mute">sync {data.device.fw_version}</Pill>}
        </div>
        {sim.state === "needs_number" && <SimNumberForm iccid={sim.iccid} busy={busy} send={send} cmd={simCmd} />}
        {sim.state === "ok" && <SimNumberForm iccid={sim.iccid} busy={busy} send={send} cmd={simCmd} current={sim.number} source={sim.source} />}
        {!data.online && <p role="status" className="mt-3 text-sm text-[#fbbf24]">The {siteName} unit is not reporting. Changes stay queued until it reconnects and expire after 15 minutes. Check that each change shows Applied.</p>}
        {!seen && data.users.length === 0 && <p className={`mt-3 text-sm ${MUTED}`}>Waiting for the first sync from {siteName}. Nothing has been received yet.</p>}
        {!seen && data.users.length > 0 && <p className={`mt-3 text-sm ${MUTED}`}>These callers are stored for {siteName}. No gate unit has reported yet, so a change made here waits until that unit is online.</p>}
      </section>

      <Section n={1} icon={Users} title="Callers who can open the gate" right={<div className="flex flex-wrap items-center gap-2">
        <label className={`${GLASS_PANEL} flex h-9 items-center gap-2 px-3`}><Search className="size-4 text-[#5CC8FF]" aria-hidden="true" />
          <input className="w-44 bg-transparent text-sm text-[#F5FBFF] outline-none placeholder:text-[#B9CFE2]" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search callers" /></label>
        <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All statuses</option><option value="on">Enabled only</option><option value="off">Disabled only</option></select>
        <button type="button" className={glassButton()} onClick={() => downloadCsv(`${siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-callers-${stampDay()}.csv`, toCsv(["Name", "Number", "Status", "Schedule", "Added"], users.map((u) => [u.name, displayPhone(u.phone), u.enabled ? "Enabled" : "Disabled", scheduleText(u), u.created_at_local ?? ""])))}><Download className="size-4" /> Export</button>
        <button type="button" className={glassButton("orange")} disabled={busy} title={lock} onClick={() => setForm("add")}><Plus className="size-4" /> Add caller</button>
      </div>}>
        {(form === "add" || editing) && <CallerForm key={editing?.local_id ?? "new"} user={editing} busy={busy} send={send} onDone={() => setForm(null)} />}
        <div className="max-h-[440px] overflow-auto"><table className="w-full border-collapse">
          <thead><tr><th className={TH}>Name</th><th className={TH}>Number</th><th className={TH}>Status</th><th className={TH}>Schedule</th><th className={TH}>Actions</th></tr></thead>
          <tbody>{users.length ? users.map((u) => <tr key={u.local_id}>
            <Td>{u.name}</Td><Td className="tabular-nums">{displayPhone(u.phone)}</Td>
            <Td><Pill tone={u.enabled ? "ok" : "bad"} caps>{u.enabled ? "Enabled" : "Disabled"}</Pill></Td>
            <Td className={MUTED}>{scheduleText(u)}</Td>
            <td className={TD}><div className="flex items-center gap-1">
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Edit ${u.name}`} disabled={busy} title={lock} onClick={() => setForm({ edit: u.local_id })}><Pencil className="size-4" /></button>
              <button type="button" className={`${glassButton()} h-8`} disabled={busy} title={lock} onClick={() => send({ kind: "user.enable", local_id: u.local_id, enabled: !u.enabled }, u.enabled ? { title: `Disable ${u.name}?`, body: "Their number will stop opening the gate until re-enabled.", action: "Disable" } : undefined)}><span>{u.enabled ? "Disable" : "Enable"}</span></button>
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${u.name}`} disabled={busy} title={lock} onClick={() => send({ kind: "user.delete", local_id: u.local_id }, { title: `Delete ${u.name}?`, body: `The caller is removed from the ${siteName} list. This cannot be undone from the portal.`, action: "Delete caller" })}><Trash2 className="size-4" /></button>
              <CmdPill c={open.get(u.local_id)} />
            </div></td></tr>)
            : <tr><Td colSpan={5}><span className={MUTED}>{data.users.length ? "No caller matches that search." : `Waiting for the first sync from ${siteName}.`}</span></Td></tr>}</tbody>
        </table></div>
      </Section>

      <HoldSection data={data} busy={busy} send={send} />

      <Section n={3} icon={tab === "calls" ? Phone : History} title={tab === "calls" ? "Every call that reached the gate" : "Changes log"} right={<div className="flex flex-wrap items-center gap-2" role="tablist">
        {tab === "calls" && <>
          <label className={`${GLASS_PANEL} flex h-9 items-center gap-2 px-3`}><Search className="size-4 text-[#5CC8FF]" aria-hidden="true" />
            <input className="w-40 bg-transparent text-sm text-[#F5FBFF] outline-none placeholder:text-[#B9CFE2]" placeholder="Search name or number" value={cq} onChange={(e) => setCq(e.target.value)} aria-label="Search calls" /></label>
          <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} aria-label="Filter by result" value={cres} onChange={(e) => setCres(e.target.value as typeof cres)}>
            <option value="all">All results</option><option value="opened">Opened</option><option value="refused">Not opened</option></select></>}
        <button type="button" className={glassButton()} onClick={() => downloadCsv(`thomastown-${tab}-${stampDay()}.csv`, tab === "calls"
          ? toCsv(["Time (site)", "Caller", "Number", "Result"], calls.map((a) => [local(a.occurred_at_local), nameFor(a), numFor(a), callResult(a.method, a.success).label]))
          : toCsv(["Time (site)", "Action", "Detail", "By"], data.changes.map((c) => [local(c.occurred_at_local), c.action ?? "", c.detail ?? "", c.changed_by ?? ""])))}><Download className="size-4" /> Export</button>
        {([["calls", "Calls"], ["changes", "Changes"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={glassButton(tab === k ? "orange" : "glass")} onClick={() => setTab(k)}>{l}</button>)}
      </div>}>
        {tab === "calls" && <p className={`m-0 mb-3 text-xs ${MUTED}`}>Numbers not on the list are shown with the number that rang. Calls with no caller ID, and repeat rings within a few seconds of the first, are not recorded by the gate and do not appear here.</p>}
        <div className="max-h-[520px] overflow-auto">{tab === "calls" ? <table className="w-full border-collapse">
          <thead><tr><th className={TH}>Time (site)</th><th className={TH}>Caller</th><th className={TH}>Number</th><th className={TH}>Result</th></tr></thead>
          <tbody>{calls.length ? calls.map((a) => { const r = callResult(a.method, a.success); return <tr key={a.local_id}>
            <Td className="tabular-nums">{local(a.occurred_at_local)}</Td><Td>{nameFor(a)}</Td><Td className="tabular-nums">{numFor(a)}</Td><Td><Pill tone={r.tone} caps>{r.label}</Pill></Td></tr>; })
            : <tr><Td colSpan={4}><span className={MUTED}>{data.access.length ? "No calls match those filters." : "No calls received yet."}</span></Td></tr>}</tbody></table>
        : <table className="w-full border-collapse">
          <thead><tr><th className={TH}>Time (site)</th><th className={TH}>Action</th><th className={TH}>Detail</th><th className={TH}>By</th></tr></thead>
          <tbody>{data.changes.length ? data.changes.map((c) => <tr key={`${c.source}${c.local_id}`}><Td className="tabular-nums">{local(c.occurred_at_local)}</Td><Td>{c.action}</Td><Td>{c.detail}</Td><Td className={MUTED}>{c.changed_by}</Td></tr>)
            : <tr><Td colSpan={4}><span className={MUTED}>No changes recorded yet.</span></Td></tr>}</tbody></table>}</div>
      </Section>

      <Section n={4} icon={ClipboardList} title="Changes sent to the Pi" right={<span className="text-xs text-muted-foreground">Pending → Applied / Failed, as reported by the Pi</span>}>
        {data.commands.length ? <div className="max-h-[260px] overflow-auto"><table className="w-full border-collapse">
          <thead><tr><th className={TH}>When</th><th className={TH}>Change</th><th className={TH}>By</th><th className={TH}>Result</th></tr></thead>
          <tbody>{data.commands.map((c) => <tr key={c.id}><Td className="tabular-nums">{ago(c.created_at, now)}</Td><Td>{commandLabel(c)}</Td><Td className={MUTED}>{c.actor_email}</Td><td className={TD}><CmdPill c={c} />{c.error ? <small className={`ml-2 ${MUTED}`}>{c.error}</small> : null}</td></tr>)}</tbody></table></div>
          : <span className={`text-sm ${MUTED}`}>No changes sent yet.</span>}
      </Section>
    </div>
  );
}

function CallerForm({ user, busy, send, onDone }: { user?: SUser; busy: boolean; send: Send; onDone: () => void }) {
  const cur = useMemo(() => { try { return JSON.parse(String(user?.schedule_data ?? "")) as { days?: number[]; start?: string; end?: string }; } catch { return {}; } }, [user]);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user ? displayPhone(user.phone) : "");
  const [stype, setStype] = useState(user?.schedule_type === "time_range" ? "time_range" : "always");
  const [sdays, setSdays] = useState<number[]>(cur.days ?? [0, 1, 2, 3, 4]);
  const [start, setStart] = useState(cur.start ?? "08:00"); const [end, setEnd] = useState(cur.end ?? "17:00");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = user ? { kind: "user.update", local_id: user.local_id } : { kind: "user.add", name, phone };
    if (user) { if (name !== user.name) body.name = name; if (phone.replace(/\D/g, "") !== user.phone.replace(/\D/g, "")) body.phone = phone; }
    const changed = !user || stype !== (user.schedule_type ?? "always") || (stype === "time_range" && (JSON.stringify(sdays) !== JSON.stringify(cur.days) || start !== cur.start || end !== cur.end));
    if (changed) { body.schedule_type = stype; if (stype === "time_range") Object.assign(body, { schedule_days: sdays, schedule_start: start, schedule_end: end }); }
    if (await send(body)) onDone();
  };
  return <form onSubmit={submit} className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-2`} aria-label={user ? `Edit ${user.name}` : "Add caller"}>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Name</span><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Mobile or phone number</span><input style={FIELD_STYLE} className={INPUT} inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} required /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Schedule</span>
      <select style={FIELD_STYLE} className={INPUT} value={stype} onChange={(e) => setStype(e.target.value)}><option value="always">Always</option><option value="time_range">Set hours</option></select></label>
    {stype === "time_range" && <div className="grid gap-2 text-xs"><span className={MUTED}>Allowed days and hours (end before start = overnight)</span>
      <DayPicker value={sdays} onChange={setSdays} />
      <div className="grid grid-cols-2 gap-2"><input style={FIELD_STYLE} className={INPUT} type="time" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
        <input style={FIELD_STYLE} className={INPUT} type="time" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div>}
    <div className="flex gap-2 md:col-span-2"><button type="submit" className={glassButton("orange")} disabled={busy}>{user ? "Save changes" : "Add caller"}</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

/** The unit read its SIM but the SIM stores no number (common on prepaid): the owner types it once. Display only; never affects who can open the gate. */
function SimNumberForm({ iccid, busy, send, cmd, current, source }: { iccid: string; busy: boolean; send: Send; cmd: SCommand | undefined; current?: string; source?: "sim" | "owner" }) {
  const [editing, setEditing] = useState(false);
  const [num, setNum] = useState("");
  if (current && !editing) return <p className={`mt-3 text-xs ${MUTED}`}>Read from {source === "owner" ? "the number you entered for this SIM" : "the SIM"}. <button type="button" className="underline" onClick={() => setEditing(true)}>Wrong number?</button> <CmdPill c={cmd} /></p>;
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await send({ kind: "sim.number", iccid, number: num })) { setEditing(false); setNum(""); } };
  return <form onSubmit={submit} className={`${GLASS_TILE} mt-3 flex flex-wrap items-end gap-2 p-3`} aria-label="Gate SIM number">
    <label className="grid gap-1 text-xs"><span className={MUTED}>{current ? "Correct dial-in number" : "This SIM does not store its own number. Enter the number callers ring, once."}</span>
      <input style={FIELD_STYLE} className={INPUT} inputMode="tel" autoComplete="off" placeholder="04xx xxx xxx" value={num} onChange={(e) => setNum(e.target.value)} required /></label>
    <button type="submit" className={glassButton("orange")} disabled={busy}>Save number</button>
    {current && <button type="button" className={glassButton()} onClick={() => setEditing(false)}>Cancel</button>}
    <CmdPill c={cmd} />
    <p className={`w-full text-xs ${MUTED}`}>Shown on this page only. It is remembered for this SIM; a different SIM will ask again.</p>
  </form>;
}

const dayText = (d: number[]) => (d.length === 7 ? "Every day" : d.map((x) => DAYN[x]).join(" "));

function HoldSection({ data, busy, send }: { data: SwingDetail; busy: boolean; send: Send }) {
  const [form, setForm] = useState<null | "add" | { edit: number }>(null);
  const holds = data.holds ?? [];
  const editing = form && typeof form === "object" ? holds.find((h) => h.local_id === form.edit) : undefined;
  const cmds = useMemo(() => { const m = new Map<number, SCommand>(); for (const c of [...data.commands].reverse()) { const id = Number(c.args.local_id); if (id && c.kind.startsWith("hold.")) m.set(id, c); } return m; }, [data.commands]);
  const ready = data.holdsReady !== false;
  const lock = busy ? "Working…" : undefined;
  return <Section n={2} icon={DoorOpen} title="Hold-open windows" right={<button type="button" className={glassButton("orange")} disabled={busy || !ready} title={lock} onClick={() => setForm("add")}><Plus className="size-4" /> Add window</button>}>
    <p className={`mb-3 text-xs ${MUTED}`}>While a window is active the site Pi holds the gate open (its hold relay stays closed), then releases it at the close time so the operator closes the gate. Lockdown releases it. Changes are applied by the Pi; wait for Applied. The Pi must have its hold relay enabled for a window to move the gate.</p>
    {!ready && <p role="status" className="mb-3 text-sm text-[#fbbf24]">Hold windows are not set up on the server yet, so they cannot be shown or changed.</p>}
    {(form === "add" || editing) && <HoldForm key={editing?.local_id ?? "new"} hold={editing} busy={busy} send={send} onDone={() => setForm(null)} />}
    <div className="overflow-auto"><table className="w-full border-collapse">
      <thead><tr><th className={TH}>Name</th><th className={TH}>Days</th><th className={TH}>Hold from</th><th className={TH}>Release at</th><th className={TH}>Status</th><th className={TH}>Actions</th></tr></thead>
      <tbody>{holds.length ? holds.map((h) => <tr key={h.local_id}>
        <Td>{h.name}</Td><Td>{dayText(h.days)}</Td><Td className="tabular-nums">{h.open_time}</Td>
        <Td className="tabular-nums">{h.close_time}{h.close_time < h.open_time ? " (next day)" : ""}</Td>
        <Td><Pill tone={h.enabled ? "ok" : "mute"}>{h.enabled ? "On" : "Off"}</Pill></Td>
        <td className={TD}><div className="flex flex-wrap items-center gap-1">
          <button type="button" className={`${glassButton()} h-8`} aria-label={`Edit ${h.name}`} disabled={busy} title={lock} onClick={() => setForm({ edit: h.local_id })}><Pencil className="size-4" /></button>
          <button type="button" className={`${glassButton()} h-8`} disabled={busy} title={lock} onClick={() => send({ kind: "hold.enable", local_id: h.local_id, enabled: !h.enabled }, h.enabled ? { title: `Turn off ${h.name}?`, body: "The gate will no longer be held open by this window.", action: "Turn off" } : undefined)}><span>{h.enabled ? "Turn off" : "Turn on"}</span></button>
          <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${h.name}`} disabled={busy} title={lock} onClick={() => send({ kind: "hold.delete", local_id: h.local_id }, { title: `Delete ${h.name}?`, body: "The window is removed from the Pi. This cannot be undone from the portal.", action: "Delete window" })}><Trash2 className="size-4" /></button>
          <CmdPill c={cmds.get(h.local_id)} />
        </div></td></tr>)
        : <tr><Td colSpan={6}><span className={MUTED}>{ready ? "No hold windows. Nothing is held open by the Pi." : "—"}</span></Td></tr>}</tbody>
    </table></div>
  </Section>;
}

function HoldForm({ hold, busy, send, onDone }: { hold?: SHold; busy: boolean; send: Send; onDone: () => void }) {
  const [name, setName] = useState(hold?.name ?? "");
  const [days, setDays] = useState<number[]>(hold?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [open, setOpen] = useState(hold?.open_time ?? "06:00"); const [close, setClose] = useState(hold?.close_time ?? "18:00");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = hold ? { kind: "hold.update", local_id: hold.local_id } : { kind: "hold.add", name, days, open_time: open, close_time: close };
    if (hold) {
      if (name !== hold.name) body.name = name;
      if (JSON.stringify(days) !== JSON.stringify(hold.days)) body.days = days;
      if (open !== hold.open_time) body.open_time = open;
      if (close !== hold.close_time) body.close_time = close;
      if (Object.keys(body).length === 2) { onDone(); return; }
    }
    if (await send(body)) onDone();
  };
  return <form onSubmit={submit} className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-2`} aria-label={hold ? `Edit ${hold.name}` : "Add hold window"}>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Name</span><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
    <div className="grid gap-1 text-xs"><span className={MUTED}>Days</span><DayPicker value={days} onChange={setDays} /></div>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Hold open from</span><input style={FIELD_STYLE} className={INPUT} type="time" value={open} onChange={(e) => setOpen(e.target.value)} required /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Release at (earlier than start = next day)</span><input style={FIELD_STYLE} className={INPUT} type="time" value={close} onChange={(e) => setClose(e.target.value)} required /></label>
    <div className="flex gap-2 md:col-span-2"><button type="submit" className={glassButton("orange")} disabled={busy || !days.length}>{hold ? "Save changes" : "Add window"}</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}
