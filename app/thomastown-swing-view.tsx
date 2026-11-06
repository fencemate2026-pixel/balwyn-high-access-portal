"use client";
// Owner → Thomastown swing gate (6 Nov 2026, Jarrod): every caller, every call and every change from
// the Magic Keys portal, stored in Azure. The gate's Pi keeps the authoritative list; this screen reads
// its mirror and QUEUES changes, which the Pi applies and confirms (Pending → Applied / Failed).
// No PIN or unlock step for the owner. No "delete all": every delete asks first. Owner-only: the API
// answers 404 to anyone else, so hiding this component is presentation, not security.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardList, Clock3, Download, History, LoaderCircle, Pencil, Phone, Plus, Search, ShieldCheck, Trash2, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, DayPicker, FIELD_STYLE, INPUT, type ConfirmSpec } from "./mildura-controls";
import { GLASS_PANEL, GLASS_TILE, glassButton } from "./glass-ui";
import { MUTED, Pill, Section, TD, TH, Td, downloadCsv, stampDay } from "./site-section-ui";
import { toCsv } from "@/lib/owner-csv";
import { GD_SITES, SWING_DEVICE_ID, callResult, displayPhone, type GdSiteId } from "@/lib/gd-swing-model";

type SUser = { local_id: number; name: string; phone: string; enabled: boolean; schedule_type: string | null; schedule_data: string | null; created_at_local: string | null };
type SAccess = { local_id: number; occurred_at_local: string | null; user_name: string | null; method: string | null; success: boolean | null };
type SChange = { local_id: number; occurred_at_local: string | null; action: string | null; detail: string | null; changed_by: string | null; source: string };
type SCommand = { id: string; seq: number; kind: string; args: Record<string, unknown>; status: "pending" | "delivered" | "applied" | "failed" | "expired"; actor_email: string; error: string | null; created_at: string };
export type SwingDetail = {
  device: { last_seen: string | null; fw_version: string | null; last_status: Record<string, unknown> | null } | null;
  users: SUser[]; access: SAccess[]; changes: SChange[]; commands: SCommand[]; online: boolean; serverTime: string;
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
export default function ThomastownSwingView({ fixture, device = SWING_DEVICE_ID }: { fixture?: SwingDetail; device?: GdSiteId } = {}) {
  const [data, setData] = useState<SwingDetail | null>(fixture ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<(ConfirmSpec & { resolve: (ok: boolean) => void }) | null>(null);

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
      toast.success(out.duplicate ? "Already queued." : "Queued for the Thomastown Pi. Wait for Applied.");
      await load(); return true;
    } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  }, [device, load]);

  if (!data) return error ? <div className={`${GLASS_PANEL} p-4 text-sm`}><Pill tone="bad">{error}</Pill></div> : <div className="flex items-center gap-2"><LoaderCircle className="animate-spin" /> Loading Thomastown…</div>;
  return <><Body data={data} busy={busy} send={send} siteName={GD_SITES[device].name} />{confirm && <ConfirmDialog spec={confirm} onClose={(ok) => { confirm.resolve(ok); setConfirm(null); }} />}</>;
}

function Body({ data, busy, send, siteName }: { data: SwingDetail; busy: boolean; send: Send; siteName: string }) {
  const now = Date.parse(data.serverTime) || Date.now();
  const seen = data.device?.last_seen ?? null;
  const [tab, setTab] = useState<"calls" | "changes">("calls");
  const [q, setQ] = useState(""); const [status, setStatus] = useState<"all" | "on" | "off">("all");
  const [cq, setCq] = useState(""); const [cres, setCres] = useState<"all" | "opened" | "refused">("all");
  const [form, setForm] = useState<null | "add" | { edit: number }>(null);
  const editing = form && typeof form === "object" ? data.users.find((u) => u.local_id === form.edit) : undefined;
  const open = useMemo(() => { const m = new Map<number, SCommand>(); for (const c of [...data.commands].reverse()) { const id = Number(c.args.local_id); if (id) m.set(id, c); } return m; }, [data.commands]);
  const users = data.users.filter((u) => (u.name + u.phone).toLowerCase().includes(q.trim().toLowerCase()) && (status === "all" || (status === "on") === u.enabled));
  const calls = data.access.filter((a) => {
    const r = callResult(a.method, a.success);
    return (cres === "all" || (cres === "opened") === (r.label === "Opened")) && `${a.user_name ?? ""}`.toLowerCase().includes(cq.trim().toLowerCase().replace(/\s/g, ""));
  });
  const nameFor = (a: SAccess) => looksLikeNumber(a.user_name) ? "Not on the list" : a.user_name ?? "Unknown";
  const numFor = (a: SAccess) => looksLikeNumber(a.user_name) ? displayPhone(a.user_name!.replace(/^\+61/, "0").replace(/\s/g, "")) : "On the list";
  const lock = busy ? "Working…" : undefined;

  return (
    <div className="mildura-view">
      <section className="gate-condition mb-4" aria-label={`${siteName} status`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2 text-lg"><ShieldCheck className="size-4 text-[#FF7A00]" aria-hidden="true" /> {siteName}</h2>
          <span className="connection-pill"><i /> Owner control · Azure · applied by the site Pi</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={data.online ? "ok" : "bad"}>{data.online ? "Online" : "Offline"} · last seen {ago(seen, now)}</Pill>
          <Pill tone="mute">{data.users.length} callers · {data.users.filter((u) => u.enabled).length} enabled</Pill>
          {data.device?.fw_version && <Pill tone="mute">sync {data.device.fw_version}</Pill>}
        </div>
        {!data.online && <p role="status" className="mt-3 text-sm text-[#fbbf24]">The Thomastown Pi is not reporting. Changes stay queued until it reconnects and expire after 15 minutes. Check that each change shows Applied.</p>}
        {!seen && <p className={`mt-3 text-sm ${MUTED}`}>Waiting for the first sync from the Thomastown Pi. Nothing has been received yet.</p>}
      </section>

      <Section n={1} icon={Users} title="Callers who can open the gate" right={<div className="flex flex-wrap items-center gap-2">
        <label className={`${GLASS_PANEL} flex h-9 items-center gap-2 px-3`}><Search className="size-4 text-[#5CC8FF]" aria-hidden="true" />
          <input className="w-44 bg-transparent text-sm text-[#F5FBFF] outline-none placeholder:text-[#B9CFE2]" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search callers" /></label>
        <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All statuses</option><option value="on">Enabled only</option><option value="off">Disabled only</option></select>
        <button type="button" className={glassButton()} onClick={() => downloadCsv(`thomastown-callers-${stampDay()}.csv`, toCsv(["Name", "Number", "Status", "Schedule", "Added"], users.map((u) => [u.name, displayPhone(u.phone), u.enabled ? "Enabled" : "Disabled", scheduleText(u), u.created_at_local ?? ""])))}><Download className="size-4" /> Export</button>
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
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${u.name}`} disabled={busy} title={lock} onClick={() => send({ kind: "user.delete", local_id: u.local_id }, { title: `Delete ${u.name}?`, body: "The caller is removed from the Thomastown Pi's list. This cannot be undone from the portal.", action: "Delete caller" })}><Trash2 className="size-4" /></button>
              <CmdPill c={open.get(u.local_id)} />
            </div></td></tr>)
            : <tr><Td colSpan={5}><span className={MUTED}>{data.users.length ? "No caller matches that search." : "Waiting for the first sync from the Thomastown Pi."}</span></Td></tr>}</tbody>
        </table></div>
      </Section>

      <Section n={2} icon={tab === "calls" ? Phone : History} title={tab === "calls" ? "Every call that reached the gate" : "Changes log"} right={<div className="flex flex-wrap items-center gap-2" role="tablist">
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

      <Section n={3} icon={ClipboardList} title="Changes sent to the Pi" right={<span className="text-xs text-muted-foreground">Pending → Applied / Failed, as reported by the Pi</span>}>
        {data.commands.length ? <div className="max-h-[260px] overflow-auto"><table className="w-full border-collapse">
          <thead><tr><th className={TH}>When</th><th className={TH}>Change</th><th className={TH}>By</th><th className={TH}>Result</th></tr></thead>
          <tbody>{data.commands.map((c) => <tr key={c.id}><Td className="tabular-nums">{ago(c.created_at, now)}</Td><Td>{c.kind}{c.args.name ? ` · ${String(c.args.name)}` : ""}{c.args.local_id ? ` · #${String(c.args.local_id)}` : ""}</Td><Td className={MUTED}>{c.actor_email}</Td><td className={TD}><CmdPill c={c} />{c.error ? <small className={`ml-2 ${MUTED}`}>{c.error}</small> : null}</td></tr>)}</tbody></table></div>
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
