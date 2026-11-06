"use client";
// Mildura Phase 2 (4 Nov 2026, Jarrod): owner controls for the Mildura Pi. Every action becomes a
// queued command (/api/owner/mildura) that the Pi polls, applies and acks; each shows Pending →
// Applied / Failed. Changes need the 10-minute administrator unlock; destructive ones confirm first.
// PIN fields are cleared from memory as soon as the request is sent and are never shown again.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, KeyRound, LoaderCircle, XCircle } from "lucide-react";
import { GLASS_PANEL, GLASS_TILE, glassButton } from "./glass-ui";

export type MirrorCommand = { id: string; seq?: number; kind: string; args?: Record<string, unknown>; status: "pending" | "delivered" | "applied" | "failed" | "expired"; actor_email?: string; error?: string | null; created_at?: string; finished_at?: string | null };
export type ControlState = { commands: MirrorCommand[]; keyFingerprint: string | null; keyRegistered: boolean; unlocked: boolean; unlockExpiresAt: number | null; gate: { open: boolean; lockdown: boolean; lockdownOn: boolean; hold: false; holdNote: string; offNote: string } };
type Send = (body: Record<string, unknown>, confirm?: ConfirmSpec) => Promise<boolean>;
export type ConfirmSpec = { title: string; body: string; action: string };
type Ctx = { state: ControlState | null; send: Send; busy: boolean; openFor: (kind: string, localId?: number) => MirrorCommand | null; preview: boolean; refresh: () => Promise<void> };

const MUTED = "text-[#B9CFE2]";
const ControlCtx = createContext<Ctx | null>(null);
export const useMilduraControl = () => useContext(ControlCtx);
export const FIELD_STYLE = { background: "#062846", color: "#F5FBFF" } as const;
export const INPUT = "h-9 w-full rounded-none border border-white/[0.18] bg-[#062846] px-3 text-sm text-[#F5FBFF] outline-none placeholder:text-[#7FA3C2] focus-visible:ring-2 focus-visible:ring-[#5CC8FF]";
const OPEN = new Set(["pending", "delivered"]);

export function MilduraControlProvider({ children, fixture }: { children: ReactNode; fixture?: ControlState }) {
  const [state, setState] = useState<ControlState | null>(fixture ?? null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<(ConfirmSpec & { resolve: (ok: boolean) => void }) | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const load = useCallback(async () => {
    if (fixture || document.hidden) return;
    try {
      const res = await fetch("/api/owner/mildura", { credentials: "same-origin", cache: "no-store" });
      if (res.ok) setState(await res.json() as ControlState);
    } catch { /* keep last state */ }
  }, [fixture]);
  const anyOpen = !!state?.commands.some((c) => OPEN.has(c.status));
  useEffect(() => {
    if (fixture) return;
    const kick = setTimeout(load, 0);
    const t = setInterval(load, anyOpen ? 4000 : 20000);
    return () => { clearTimeout(kick); clearInterval(t); };
  }, [load, anyOpen, fixture]);

  const send: Send = useCallback(async (body, c) => {
    if (c && !await new Promise<boolean>((resolve) => setConfirm({ ...c, resolve }))) return false;
    if (fixture) { setToast({ tone: "ok", text: "Preview only — nothing was sent." }); return true; }
    setBusy(true);
    try {
      const res = await fetch("/api/owner/mildura", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, clientKey: crypto.randomUUID() }), signal: AbortSignal.timeout(15000) });
      const out = await res.json().catch(() => ({})) as { error?: string; code?: string };
      if (!res.ok) {
        if (out.code === "admin_password_required") setState((s) => s && { ...s, unlocked: false });
        throw new Error(out.error ?? "The command could not be queued.");
      }
      setToast({ tone: "ok", text: "Queued for the Mildura Pi. Wait for Applied to confirm the change reached the Pi." });
      await load();
      return true;
    } catch (e) { setToast({ tone: "bad", text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  }, [fixture, load]);

  const openFor = useCallback((kind: string, localId?: number) => {
    const list = state?.commands ?? [];
    return list.find((c) => c.kind.split(".")[0] === kind && (localId === undefined || c.args?.local_id === localId) && (OPEN.has(c.status) || c.status === "failed")) ?? null;
  }, [state]);
  const value = useMemo(() => ({ state, send, busy, openFor, preview: !!fixture, refresh: load }), [state, send, busy, openFor, fixture, load]);
  return <ControlCtx.Provider value={value}>
    {children}
    {confirm && <ConfirmDialog spec={confirm} onClose={(ok) => { confirm.resolve(ok); setConfirm(null); }} />}
    {toast && <div role="status" className={`${GLASS_PANEL} fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 p-3 text-sm`} onClick={() => setToast(null)}>
      {toast.tone === "ok" ? <CheckCircle2 className="size-4 shrink-0 text-[#34d399]" /> : <XCircle className="size-4 shrink-0 text-[#ff6b6b]" />}<span>{toast.text}</span></div>}
  </ControlCtx.Provider>;
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: (ok: boolean) => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#020c18]/70 p-4" role="alertdialog" aria-modal="true" aria-labelledby="mk-confirm-title">
    <div className={`${GLASS_PANEL} w-full max-w-md p-5`}>
      <h3 id="mk-confirm-title" className="m-0 flex items-center gap-2 text-base" style={{ color: "#F5FBFF" }}><AlertTriangle className="size-4 text-[#FF7A00]" /> <span style={{ color: "#F5FBFF" }}>{spec.title}</span></h3>
      <p className="mt-2 text-sm"><span style={{ color: "#B9CFE2" }}>{spec.body}</span></p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={glassButton()} onClick={() => onClose(false)}>Cancel</button>
        <button type="button" ref={ok} className={glassButton("orange")} onClick={() => onClose(true)}>{spec.action}</button>
      </div>
    </div>
  </div>;
}

const STATUS: Record<MirrorCommand["status"], [string, string, typeof Clock3]> = {
  pending: ["Pending", "text-[#fbbf24]", Clock3], delivered: ["Applying", "text-[#fbbf24]", LoaderCircle],
  applied: ["Applied", "text-[#34d399]", CheckCircle2], failed: ["Failed", "text-[#ff6b6b]", XCircle], expired: ["Expired", "text-[#ff6b6b]", XCircle],
};
export function CommandPill({ c }: { c: MirrorCommand | null }) {
  if (!c) return null;
  const [label, tone, Icon] = STATUS[c.status];
  return <em className={`telemetry-badge not-italic text-[10px] font-bold uppercase tracking-[.08em] ${tone}`} title={c.error ?? undefined}><Icon className={`size-3 ${c.status === "delivered" ? "animate-spin" : ""}`} />{label}</em>;
}

/** Header strip of Section 1: gate buttons and the Pi command key. No separate unlock step (4 Nov 2026, Jarrod). */
export function ControlBar() {
  const ctx = useMilduraControl();
  if (!ctx) return null;
  const s = ctx.state;
  const can = !!s?.unlocked && !ctx.busy;
  return <div className="mt-4 grid gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={glassButton("orange")} disabled={!can || !s?.gate.open} title={s?.gate.open ? undefined : s?.gate.offNote}
        onClick={() => ctx.send({ kind: "gate.open" }, { title: "Open the Mildura boom gate?", body: "The Pi sends ONE opening pulse through the gate app (same as its dashboard's Open Gate). It is dropped if the Pi does not pick it up within 90 seconds.", action: "Open gate" })}>Open Gate</button>
      <button type="button" className={glassButton()} disabled title={s?.gate.holdNote}>Hold Open</button>
      <button type="button" className={glassButton()} disabled={!can || !s?.gate.lockdown} title={s?.gate.lockdown ? undefined : s?.gate.offNote}
        onClick={() => ctx.send({ kind: "gate.lockdown", on: !s?.gate.lockdownOn }, s?.gate.lockdownOn
          ? { title: "End lockdown?", body: "Keypad and web PINs will open the gate again.", action: "Resume access" }
          : { title: "Lock down Mildura?", body: "No PIN (keypad or web) and no remote Open will work until lockdown is ended. It does not close the boom or override the time clock.", action: "Lock down" })}>{s?.gate.lockdownOn ? "End Lockdown" : "Lockdown"}</button>
      <small className={`${MUTED} max-w-xl`}>{s?.gate.open ? "Hold Open is off: the hold line is disconnected and the time clock holds the boom. Open Gate is refused while an auto-open schedule is active." : s?.gate.offNote}</small>
    </div>
    <div className={`${GLASS_TILE} flex flex-wrap items-center justify-between gap-3 p-3 text-sm`}>
      <span className="flex items-center gap-2"><KeyRound className="size-4 text-[#5CC8FF]" />
        {s?.keyRegistered ? <>Pi command key <code className={MUTED} title={s.keyFingerprint ?? ""}>{s.keyFingerprint?.slice(0, 16)}…</code></> : <span className="text-[#fbbf24]">Pi has not registered its command key — keypad codes cannot be sent to it yet</span>}</span>
      <em className="telemetry-badge not-italic text-[#34d399]"><i className="signal-dot" />Signed in as owner</em>
    </div>
  </div>;
}

/** Recent commands with their Pi result. */
export function CommandList() {
  const ctx = useMilduraControl();
  const list = ctx?.state?.commands ?? [];
  if (!list.length) return <p className={`m-0 text-sm ${MUTED}`}>No commands sent yet.</p>;
  return <div className="max-h-72 overflow-auto"><table className="w-full border-collapse text-sm"><tbody>
    {list.slice(0, 20).map((c) => <tr key={c.id} className="border-b border-white/[0.08]">
      <td className="px-2 py-1.5"><span>{c.kind.replace(".", " · ")}</span></td>
      <td className="px-2 py-1.5"><span className={MUTED}>{describe(c)}</span></td>
      <td className="px-2 py-1.5"><CommandPill c={c} /></td>
      <td className="px-2 py-1.5"><span className={`${MUTED} text-xs`}>{c.error ?? ""}</span></td>
    </tr>)}</tbody></table></div>;
}
function describe(c: MirrorCommand) {
  const a = c.args ?? {};
  return [a.name, a.local_id !== undefined ? `#${a.local_id}` : null, typeof a.enabled === "boolean" ? (a.enabled ? "on" : "off") : null].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- forms
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function DayPicker({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  return <div className="flex flex-wrap gap-1" role="group" aria-label="Days">{DAYS.map((d, i) => {
    const on = value.includes(i);
    return <button key={d} type="button" aria-pressed={on} className={`${glassButton(on ? "orange" : "glass")} h-8 min-w-11 px-2 text-xs`} onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}>{d}</button>;
  })}</div>;
}

export type UserLite = { local_id: number; name: string; schedule_type: string | null; schedule_data: unknown };
/** Add or edit a user. PIN only ever travels in the POST body; it is wiped from state right after. */
export function UserForm({ user, onDone }: { user?: UserLite; users?: UserLite[]; onDone: () => void }) {
  const ctx = useMilduraControl();
  const [name, setName] = useState(user?.name ?? "");
  const [pin, setPin] = useState(""); const [pin2, setPin2] = useState("");
  const cur = useMemo(() => { try { return JSON.parse(String(user?.schedule_data ?? "")) as { days?: number[]; start?: string; end?: string }; } catch { return {}; } }, [user]);
  const [stype, setStype] = useState(user?.schedule_type === "time_range" ? "time_range" : "always");
  const [sdays, setSdays] = useState<number[]>(cur.days ?? [0, 1, 2, 3, 4]);
  const [start, setStart] = useState(cur.start ?? "08:00"); const [end, setEnd] = useState(cur.end ?? "17:00");
  const [err, setErr] = useState("");
  if (!ctx) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!user || pin) { if (!/^\d{4,6}$/.test(pin)) return setErr("PIN must be 4 to 6 digits."); if (pin !== pin2) return setErr("The two PINs do not match."); }
    const body: Record<string, unknown> = user ? { kind: "user.update", local_id: user.local_id } : { kind: "user.add" };
    if (!user || name !== user.name) body.name = name;
    if (pin) body.pin = pin;
    const changed = !user || stype !== (user.schedule_type ?? "always") || (stype === "time_range" && (JSON.stringify(sdays) !== JSON.stringify(cur.days) || start !== cur.start || end !== cur.end));
    if (changed) { body.schedule_type = stype; if (stype === "time_range") Object.assign(body, { schedule_days: sdays, schedule_start: start, schedule_end: end }); }
    setPin(""); setPin2("");                                        // never keep the PIN around
    if (await ctx.send(body)) onDone();
  };
  const disabled = !ctx.state?.unlocked || ctx.busy || (!user && !ctx.state?.keyRegistered);
  return <form onSubmit={submit} className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-2`} aria-label={user ? `Edit ${user.name}` : "Add user"}>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Name</span><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="grid gap-1 text-xs"><span className={MUTED}>{user ? "New PIN (optional)" : "PIN (4-6 digits)"}</span><input style={FIELD_STYLE} className={INPUT} type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required={!user} disabled={!ctx.state?.keyRegistered} /></label>
      <label className="grid gap-1 text-xs"><span className={MUTED}>Repeat PIN</span><input style={FIELD_STYLE} className={INPUT} type="password" inputMode="numeric" autoComplete="off" value={pin2} maxLength={6} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} required={!user || !!pin} disabled={!ctx.state?.keyRegistered} /></label>
    </div>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Schedule</span>
      <select style={FIELD_STYLE} className={INPUT} value={stype} onChange={(e) => setStype(e.target.value)}>
        <option value="always">Always</option><option value="time_range">Set hours</option></select></label>
    {stype === "time_range" ? <div className="grid gap-2 text-xs"><span className={MUTED}>Allowed days and hours (end before start = overnight)</span>
      <DayPicker value={sdays} onChange={setSdays} />
      <div className="grid grid-cols-2 gap-2"><input style={FIELD_STYLE} className={INPUT} type="time" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
        <input style={FIELD_STYLE} className={INPUT} type="time" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div>
      : <span className={`self-end text-xs ${MUTED}`}>PINs are encrypted to the Mildura Pi and never stored in the cloud.</span>}
    {err && <p role="alert" className="m-0 text-sm text-[#ff6b6b] md:col-span-2">{err}</p>}
    <div className="flex gap-2 md:col-span-2"><button type="submit" className={glassButton("orange")} disabled={disabled}>{user ? "Save changes" : "Add user"}</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

export function ScheduleForm({ onDone }: { onDone: () => void }) {
  const ctx = useMilduraControl();
  const [name, setName] = useState(""); const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [open, setOpen] = useState("09:00"); const [close, setClose] = useState("17:00");
  if (!ctx) return null;
  return <form className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-[1fr_auto_auto]`} aria-label="Add auto-open schedule"
    onSubmit={async (e) => { e.preventDefault(); if (await ctx.send({ kind: "schedule.add", name, days, open_time: open, close_time: close })) onDone(); }}>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Name</span><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Opens</span><input style={FIELD_STYLE} className={INPUT} type="time" value={open} onChange={(e) => setOpen(e.target.value)} required /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Closes</span><input style={FIELD_STYLE} className={INPUT} type="time" value={close} onChange={(e) => setClose(e.target.value)} required /></label>
    <div className="md:col-span-3"><DayPicker value={days} onChange={setDays} /></div>
    <div className="flex gap-2 md:col-span-3"><button type="submit" className={glassButton("orange")} disabled={!ctx.state?.unlocked || ctx.busy || !days.length}>Add schedule</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

export function PersonForm({ onDone }: { onDone: () => void }) {
  const ctx = useMilduraControl();
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [phone, setPhone] = useState(""); const [pin, setPin] = useState("");
  if (!ctx) return null;
  const needsKey = (!!phone || !!pin) && !ctx.state?.keyRegistered;
  return <form className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-4`} aria-label="Add authorised person"
    onSubmit={async (e) => { e.preventDefault(); const b = { kind: "person.add", name, role, ...(phone ? { phone } : {}), ...(pin ? { pin } : {}) }; setPin(""); if (await ctx.send(b)) onDone(); }}>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Name</span><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Role</span><input style={FIELD_STYLE} className={INPUT} value={role} maxLength={60} onChange={(e) => setRole(e.target.value)} /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>Phone (optional, encrypted)</span><input style={FIELD_STYLE} className={INPUT} value={phone} maxLength={16} onChange={(e) => setPhone(e.target.value)} /></label>
    <label className="grid gap-1 text-xs"><span className={MUTED}>PIN (optional, encrypted)</span><input style={FIELD_STYLE} className={INPUT} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></label>
    <div className="flex gap-2 md:col-span-4"><button type="submit" className={glassButton("orange")} disabled={!ctx.state?.unlocked || ctx.busy || needsKey}>Add person</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}


