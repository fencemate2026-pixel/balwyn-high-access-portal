"use client";
// Owner → Sites. 30 Oct 2026 (Jarrod): the Magic Keys owner's own console for
// every RJL GSM gate dialler site. Sites listed on the left; picking one shows
// its gate units (online, applied, network, relays), whitelist, auto-open times,
// call log, authorised persons and changes log — the Mildura dashboard concept.
// Shown only to the verified owner; /api/owner/sites re-checks that on every
// request, so hiding this component is presentation, not security.
// No "delete all": one click must never be able to wipe a whitelist.
import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RESULT_LABELS, UNIT_ONLINE_SECONDS, localAu } from "@/lib/owner-sites-model";

type Unit = {
  id: string; device_id: string; name: string; gate_type: string; sim_number: string | null; enabled: boolean; lockdown: boolean;
  pulse_seconds: number; last_seen: string | null; applied_version: number; fw_version: string | null; has_device_key: boolean;
  last_status: null | { hold_on?: boolean; dry_run?: boolean; whitelist_enabled?: number; outbox?: number;
    checks?: Record<string, boolean>; gsm?: { registered?: boolean; clip_armed?: boolean; csq?: number | null; operator?: string | null };
    sync?: { refused_version?: number | null } };
};
type SiteRow = { id: string; slug: string; name: string; config_version: number; gd_units: Pick<Unit, "id" | "last_seen" | "applied_version" | "enabled" | "lockdown">[] };
type Entry = { id: string; name: string; phone_e164: string; unit_label: string | null; enabled: boolean; last_authorised_by: string | null };
type Window = { id: string; unit_id: string; name: string; days: number[]; open_time: string; close_time: string; span_days: number; enabled: boolean };
type Person = { id: string; name: string; role: string | null; phone: string | null };
type Detail = { site: { id: string; slug: string; name: string; address: string | null; config_version: number }; units: Unit[]; whitelist: Entry[]; schedules: Window[]; persons: Person[]; serverTime: string };
type Call = { id: number; unit_id: string; occurred_at: string; phone_e164: string | null; caller_name: string | null; result: string; detail: string | null };
type Change = { id: number; at: string; actor_email: string | null; authorised_by: string | null; entity: string; action: string; detail: { old?: Record<string, unknown>; new?: Record<string, unknown> } };
type Tab = "gates" | "whitelist" | "schedule" | "calls" | "persons" | "changes";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TZ = "Australia/Melbourne";
const fmt = (ts: string | null) => ts ? new Date(ts).toLocaleString("en-AU", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const ago = (ts: string | null, now: number) => {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const online = (u: { last_seen: string | null }, now: number) => !!u.last_seen && (now - Date.parse(u.last_seen)) / 1000 < UNIT_ONLINE_SECONDS;

const CSS = `
.os-wrap{display:grid;grid-template-columns:230px 1fr;gap:16px;align-items:start}
.os-list{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--border,#e3e7ef);border-radius:12px;background:var(--card,#fff)}
.os-list h4{margin:4px 6px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.65}
.os-site{display:flex;gap:10px;align-items:center;text-align:left;padding:9px 10px;border-radius:8px;border:0;background:none;cursor:pointer;color:inherit}
.os-site:hover{background:rgba(127,127,127,.08)} .os-site.on{background:rgba(255,107,0,.1);outline:1px solid rgba(255,107,0,.35)}
.os-site small{display:block;opacity:.65;font-size:12px}
.os-dot{width:10px;height:10px;border-radius:50%;background:#9aa3b2;flex-shrink:0} .os-dot.ok{background:#0f9d58} .os-dot.bad{background:#d93025} .os-dot.warn{background:#f4b400}
.os-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#e3e7ef);margin:10px 0 14px;overflow-x:auto}
.os-tab{border:0;background:none;padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer;color:inherit;opacity:.7;white-space:nowrap}
.os-tab.on{opacity:1;border-color:#ff6b00;font-weight:600}
.os-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.os-card{border:1px solid var(--border,#e3e7ef);border-radius:12px;padding:14px;background:var(--card,#fff)}
.os-card h3{margin:0;font-size:15px;display:flex;gap:8px;align-items:center}
.os-kv{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;font-size:13px;margin:10px 0}
.os-kv>span:nth-child(odd){opacity:.65}
.os-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;margin:0 4px 4px 0}
.os-ok{background:rgba(15,157,88,.12);color:#0b7a44} .os-bad{background:rgba(217,48,37,.12);color:#b3261e}
.os-warn{background:rgba(244,180,0,.16);color:#8a5a00} .os-mute{background:rgba(127,127,127,.12)}
.os-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.os-form{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:8px;margin:8px 0 12px}
.os-table{width:100%;border-collapse:collapse;font-size:13px}
.os-table th,.os-table td{padding:8px;border-bottom:1px solid var(--border,#e3e7ef);text-align:left;vertical-align:middle}
.os-table th{font-size:12px;opacity:.65;font-weight:600}
.os-scroll{overflow-x:auto;border:1px solid var(--border,#e3e7ef);border-radius:12px}
.os-banner{padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:13px;border:1px solid}
.os-banner.warn{background:rgba(244,180,0,.12);border-color:rgba(244,180,0,.5)} .os-banner.info{background:rgba(26,95,209,.08);border-color:rgba(26,95,209,.35)}
.os-days label{display:inline-flex;gap:3px;align-items:center;margin-right:8px;font-size:13px}
.os-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
@media (max-width:900px){.os-wrap{grid-template-columns:1fr}.os-form{grid-template-columns:1fr 1fr}.os-kv{grid-template-columns:110px 1fr}}
`;

async function api<T>(init?: { body?: Record<string, unknown>; query?: string }): Promise<T> {
  const res = await fetch(`/api/owner/sites${init?.query ?? ""}`, init?.body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body), credentials: "same-origin" }
    : { credentials: "same-origin", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed.");
  return data as T;
}

export default function OwnerSitesPanel() {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("gates");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState("");
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [callUnit, setCallUnit] = useState("");
  const [callResult, setCallResult] = useState("");

  const loadSites = useCallback(async () => {
    const data = await api<{ sites: SiteRow[] }>();
    setSites(data.sites);
    setSlug((current) => current ?? data.sites.find((s) => s.slug === "thomastown")?.slug ?? data.sites[0]?.slug ?? null);
  }, []);
  const loadDetail = useCallback(async (which: string) => {
    const data = await api<Detail>({ query: `?site=${encodeURIComponent(which)}` });
    setDetail(data); setNow(Date.parse(data.serverTime) || Date.now());
  }, []);
  const loadCalls = useCallback(async (which: string) => {
    const q = new URLSearchParams({ site: which, view: "calls" });
    if (callUnit) q.set("unit", callUnit); if (callResult) q.set("result", callResult);
    setCalls((await api<{ calls: Call[] }>({ query: `?${q}` })).calls);
  }, [callUnit, callResult]);
  const loadChanges = useCallback(async (which: string) => {
    setChanges((await api<{ changes: Change[] }>({ query: `?site=${encodeURIComponent(which)}&view=changes` })).changes);
  }, []);

  // One loader for everything on screen. It runs from timer callbacks (never
  // synchronously inside the effect), immediately and then every 5 s while the
  // page is visible: unit health, applied version and new calls stay live.
  useEffect(() => {
    let first = true;
    const run = () => {
      if (!first && document.hidden) return;
      const loud = first; first = false;
      const report = (e: Error) => { if (loud) toast.error(e.message); };
      loadSites().catch(report);
      if (!slug) return;
      loadDetail(slug).catch(report);
      if (tab === "calls") loadCalls(slug).catch(report);
      if (tab === "changes") loadChanges(slug).catch(report);
    };
    const kick = setTimeout(run, 0);
    const timer = setInterval(run, 5000);
    return () => { clearTimeout(kick); clearInterval(timer); };
  }, [slug, tab, loadSites, loadDetail, loadCalls, loadChanges]);
  // The person this change is made for; defaults to the first authorised person.
  const actingName = acting || detail?.persons[0]?.name || "";

  const act = useCallback(async (body: Record<string, unknown>, done: string) => {
    if (!detail) return false;
    setBusy(true);
    try {
      const data = await api<Detail>({ body: { ...body, site: detail.site.slug, authorisedBy: actingName || undefined } });
      setDetail(data); toast.success(done); loadSites().catch(() => undefined);
      if (tab === "changes") loadChanges(detail.site.slug).catch(() => undefined);
      return true;
    } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  }, [detail, actingName, tab, loadSites, loadChanges]);

  if (!sites) return <div className="os-row"><LoaderCircle className="animate-spin" /> Loading sites…</div>;
  if (!sites.length) return <p>No sites yet.</p>;

  const dot = (s: SiteRow) => !s.gd_units.length ? "" : s.gd_units.some((u) => !online(u, now)) ? "bad"
    : s.gd_units.some((u) => u.applied_version < s.config_version || u.lockdown) ? "warn" : "ok";

  return (
    <section className="os-wrap" aria-label="Owner sites">
      <style>{CSS}</style>
      <nav className="os-list" aria-label="Sites">
        <h4>My sites</h4>
        {sites.map((s) => (
          <button key={s.id} type="button" className={`os-site ${s.slug === slug ? "on" : ""}`} onClick={() => { setSlug(s.slug); setCalls(null); setChanges(null); }}>
            <span className={`os-dot ${dot(s)}`} />
            <span>{s.name}<small>{s.gd_units.length} gate unit{s.gd_units.length === 1 ? "" : "s"}</small></span>
          </button>
        ))}
      </nav>
      <div>
        {!detail ? <div className="os-row"><LoaderCircle className="animate-spin" /> Loading…</div> : <>
          <div className="os-row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0 }}>{detail.site.name}</h2>
              <small style={{ opacity: .7 }}>{detail.site.address} · {detail.whitelist.filter((w) => w.enabled).length} active numbers · config v{detail.site.config_version}</small>
            </div>
            <label className="os-row" style={{ fontSize: 13 }}>Acting on authority of
              <NativeSelect value={actingName} onChange={(e) => setActing(e.target.value)} aria-label="Acting on authority of">
                {detail.persons.length ? detail.persons.map((p) => <NativeSelectOption key={p.id} value={p.name}>{p.name}</NativeSelectOption>)
                  : <NativeSelectOption value="">Myself</NativeSelectOption>}
              </NativeSelect>
            </label>
          </div>
          <PendingBanner detail={detail} now={now} busy={busy} onAck={() => {
            if (window.confirm("Send the reduced whitelist to the gates? Removed numbers will stop opening the gate.")) void act({ action: "site.ackShrink", seenVersion: detail.site.config_version }, "Large removal confirmed");
          }} />
          <div className="os-tabs" role="tablist">
            {([["gates", "Gate units"], ["whitelist", "Whitelist"], ["schedule", "Auto-open times"], ["calls", "Call log"], ["persons", "Authorised persons"], ["changes", "Changes log"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`os-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "gates" && <Units detail={detail} now={now} busy={busy} act={act} />}
          {tab === "whitelist" && <Whitelist detail={detail} busy={busy} act={act} />}
          {tab === "schedule" && <Schedules detail={detail} busy={busy} act={act} />}
          {tab === "calls" && <>
            <div className="os-row" style={{ marginBottom: 10 }}>
              <NativeSelect value={callUnit} onChange={(e) => setCallUnit(e.target.value)} aria-label="Gate">
                <NativeSelectOption value="">All gates</NativeSelectOption>
                {detail.units.map((u) => <NativeSelectOption key={u.id} value={u.id}>{u.name}</NativeSelectOption>)}
              </NativeSelect>
              <NativeSelect value={callResult} onChange={(e) => setCallResult(e.target.value)} aria-label="Result">
                <NativeSelectOption value="">All results</NativeSelectOption>
                {Object.entries(RESULT_LABELS).map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
              </NativeSelect>
              <Button variant="outline" size="sm" onClick={() => slug && loadCalls(slug)}><RefreshCw /> Refresh</Button>
              <small style={{ opacity: .65 }}>Latest 300 · refreshes every 5 s</small>
            </div>
            <CallTable calls={calls} units={detail.units} />
          </>}
          {tab === "persons" && <Persons detail={detail} busy={busy} act={act} />}
          {tab === "changes" && <ChangeTable changes={changes} />}
        </>}
      </div>
    </section>
  );
}

type Act = (body: Record<string, unknown>, done: string) => Promise<boolean>;

function PendingBanner({ detail, now, busy, onAck }: { detail: Detail; now: number; busy: boolean; onAck: () => void }) {
  const waiting = detail.units.filter((u) => u.applied_version < detail.site.config_version);
  if (!waiting.length) return null;
  const refused = waiting.some((u) => u.last_status?.sync?.refused_version);
  return (
    <div className="os-banner warn" style={{ marginTop: 12 }}>
      <b>Waiting:</b> {waiting.map((u) => u.name).join(", ")} {waiting.length > 1 ? "have" : "has"} not applied the latest change yet
      {waiting.some((u) => !online(u, now)) ? " (offline — it applies on reconnect)" : ""}.
      {refused && <> A unit refused a large whitelist removal (over 10 %). <Button size="sm" disabled={busy} onClick={onAck}>Confirm large removal</Button></>}
    </div>
  );
}

function Units({ detail, now, busy, act }: { detail: Detail; now: number; busy: boolean; act: Act }) {
  return (
    <div className="os-grid">
      {detail.units.map((u) => {
        const st = u.last_status ?? {}, g = st.gsm ?? {}, on = online(u, now), applied = u.applied_version >= detail.site.config_version;
        const windows = detail.schedules.filter((w) => w.unit_id === u.id && w.enabled);
        return (
          <article className="os-card" key={u.id}>
            <h3><span className={`os-dot ${on ? "ok" : "bad"}`} />{u.name}</h3>
            <div className="os-mono" style={{ opacity: .6 }}>{u.device_id}</div>
            <div style={{ marginTop: 8 }}>
              <span className={`os-pill ${on ? "os-ok" : "os-bad"}`}>{on ? "Online" : "Offline"}</span>
              <span className={`os-pill ${applied ? "os-ok" : "os-warn"}`}>{applied ? `Applied v${u.applied_version}` : `Waiting (has v${u.applied_version})`}</span>
              {u.lockdown && <span className="os-pill os-bad">LOCKDOWN</span>}
              {!u.enabled && <span className="os-pill os-bad">DISABLED</span>}
              {st.hold_on && <span className="os-pill os-warn">Held open</span>}
              {st.dry_run && <span className="os-pill os-warn">DRY RUN</span>}
            </div>
            <div className="os-kv">
              <span>Last contact</span><span>{ago(u.last_seen, now)}</span>
              <span>Network</span><span>{g.registered ? `${g.operator ?? "registered"} · signal ${g.csq ?? "?"}/31` : <b style={{ color: "#b3261e" }}>not registered</b>}</span>
              <span>Caller ID armed</span><span>{g.clip_armed ? "yes" : "no"}</span>
              <span>Relays</span><span>{st.checks?.relay_ready ? "ready" : <b style={{ color: "#b3261e" }}>not ready</b>}</span>
              <span>Numbers on unit</span><span>{st.whitelist_enabled ?? "—"}</span>
              <span>Calls to upload</span><span>{st.outbox ?? "—"}</span>
              <span>Auto-open</span><span>{windows.length ? windows.map((w) => `${w.name} ${w.open_time.slice(0, 5)}–${w.close_time.slice(0, 5)}`).join(" · ") : "none (calls 24/7)"}</span>
              <span>SIM number</span><span>{u.sim_number ?? "—"}</span>
              <span>Pulse</span><span>{u.pulse_seconds} s</span>
              <span>Device key</span><span>{u.has_device_key ? <span className="os-pill os-ok">set</span> : <span className="os-pill os-warn">not set</span>}</span>
              <span>Software</span><span className="os-mono">{u.fw_version ?? "—"}</span>
            </div>
            <div className="os-row">
              <Button size="sm" variant={u.lockdown ? "default" : "outline"} disabled={busy} onClick={() => {
                if (!u.lockdown && !window.confirm(`Lock down ${u.name}? No phone call will open it and the auto-open hold is released (the backup time clock can still hold it open).`)) return;
                void act({ action: "unit.update", unitId: u.id, lockdown: !u.lockdown }, u.lockdown ? "Lockdown ended" : "Lockdown on");
              }}>{u.lockdown ? "End lockdown" : "Lockdown"}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                if (u.enabled && !window.confirm(`Disable ${u.name}? It will refuse every call until re-enabled.`)) return;
                void act({ action: "unit.update", unitId: u.id, enabled: !u.enabled }, u.enabled ? "Unit disabled" : "Unit enabled");
              }}>{u.enabled ? "Disable unit" : "Enable unit"}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                const sim = window.prompt("SIM number for this unit", u.sim_number ?? ""); if (sim === null) return;
                const pulse = window.prompt("Relay pulse in seconds (0.2 to 3)", String(u.pulse_seconds)); if (pulse === null) return;
                void act({ action: "unit.update", unitId: u.id, simNumber: sim, pulseSeconds: Number(pulse) }, "Saved");
              }}>Edit SIM / pulse</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                const fp = window.prompt("Paste the 64-character device key fingerprint printed by install.sh on this unit:"); if (!fp) return;
                void act({ action: "unit.update", unitId: u.id, deviceKeyFingerprint: fp.trim() }, "Device key set — the unit should come online within seconds");
              }}>{u.has_device_key ? "Replace device key" : "Set device key"}</Button>
            </div>
          </article>
        );
      })}
      <p style={{ gridColumn: "1/-1", opacity: .7, fontSize: 13 }}>Changes reach an online gate in about 1–2 seconds. “Applied” means that gate has confirmed it is using the latest list and times.</p>
    </div>
  );
}

function Whitelist({ detail, busy, act }: { detail: Detail; busy: boolean; act: Act }) {
  const [q, setQ] = useState(""); const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [unit, setUnit] = useState("");
  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    return detail.whitelist.filter((w) => !f || [w.name, w.unit_label ?? "", w.phone_e164, localAu(w.phone_e164)].join(" ").toLowerCase().includes(f));
  }, [q, detail.whitelist]);
  return <>
    <div className="os-card" style={{ marginBottom: 12 }}>
      <h3><Plus /> Add a number</h3>
      <form className="os-form" onSubmit={async (e) => {
        e.preventDefault();
        if (await act({ action: "whitelist.add", name, phone, unitLabel: unit }, `Added ${name}`)) { setName(""); setPhone(""); setUnit(""); }
      }}>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <Input placeholder="Mobile 04xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" />
        <Input placeholder="Unit (e.g. Unit 12)" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} />
        <Button type="submit" disabled={busy}>Add</Button>
      </form>
      <small style={{ opacity: .7 }}>Applies to every gate at this site.</small>
    </div>
    <div className="os-row" style={{ marginBottom: 10 }}>
      <Input placeholder="Search name, unit or number" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      <small style={{ opacity: .7 }}>{rows.length} shown · {detail.whitelist.filter((w) => w.enabled).length} active of {detail.whitelist.length}</small>
    </div>
    <div className="os-scroll"><table className="os-table">
      <thead><tr><th>Unit</th><th>Name</th><th>Mobile</th><th>Status</th><th>Last change by</th><th /></tr></thead>
      <tbody>{rows.map((w) => (
        <tr key={w.id}>
          <td>{w.unit_label ?? "—"}</td><td>{w.name}</td><td className="os-mono">{localAu(w.phone_e164)}</td>
          <td><span className={`os-pill ${w.enabled ? "os-ok" : "os-mute"}`}>{w.enabled ? "Active" : "Disabled"}</span></td>
          <td style={{ opacity: .7 }}>{w.last_authorised_by ?? ""}</td>
          <td style={{ whiteSpace: "nowrap" }}>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              const n = window.prompt("Name", w.name); if (n === null) return;
              const p = window.prompt("Mobile", localAu(w.phone_e164)); if (p === null) return;
              const u = window.prompt("Unit", w.unit_label ?? ""); if (u === null) return;
              void act({ action: "whitelist.update", id: w.id, name: n, phone: p, unitLabel: u, enabled: w.enabled }, "Updated");
            }}>Edit</Button>{" "}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ action: "whitelist.toggle", id: w.id, enabled: !w.enabled }, `${w.name} ${w.enabled ? "disabled" : "enabled"}`)}>{w.enabled ? "Disable" : "Enable"}</Button>{" "}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              if (window.confirm(`Delete ${w.name} (${localAu(w.phone_e164)})? They will no longer open the gates.`)) void act({ action: "whitelist.delete", id: w.id }, `Deleted ${w.name}`);
            }}>Delete</Button>
          </td>
        </tr>))}
      </tbody>
    </table></div>
  </>;
}

function WindowForm({ unitId, row, busy, act, onCancel }: { unitId: string; row?: Window; busy: boolean; act: Act; onCancel?: () => void }) {
  const [name, setName] = useState(row?.name ?? "Daily hold open");
  const [open, setOpen] = useState(row?.open_time.slice(0, 5) ?? "06:00");
  const [close, setClose] = useState(row?.close_time.slice(0, 5) ?? "18:00");
  const [span, setSpan] = useState(row?.span_days ?? 0);
  const [days, setDays] = useState<number[]>(row?.days ?? [1, 2, 3, 4, 5, 6, 7]);
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  return (
    <div className="os-card" style={{ marginTop: 8 }}>
      <div className="os-row">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={{ flex: 1, minWidth: 160 }} aria-label="Window name" />
        <label className="os-row">Open <Input type="time" value={open} onChange={(e) => setOpen(e.target.value)} /></label>
        <label className="os-row">Close <Input type="time" value={close} onChange={(e) => setClose(e.target.value)} /></label>
        <label className="os-row" title="Extra whole days before the close time, e.g. Friday open → Monday close = 3">+days <Input type="number" min={0} max={6} value={span} onChange={(e) => setSpan(Number(e.target.value))} style={{ width: 64 }} /></label>
      </div>
      <div className="os-days" style={{ marginTop: 8 }}>
        {DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays((cur) => e.target.checked ? [...cur, i + 1] : cur.filter((x) => x !== i + 1))} />{d}</label>)}
        <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enabled</label>
      </div>
      <div className="os-row" style={{ marginTop: 8 }}>
        <Button size="sm" disabled={busy} onClick={async () => {
          if (await act({ action: "schedule.save", unitId, id: row?.id, name, openTime: open, closeTime: close, spanDays: span, days, enabled }, "Auto-open times saved") && onCancel) onCancel();
        }}>Save</Button>
        {row ? <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          if (window.confirm("Delete this auto-open window?")) void act({ action: "schedule.delete", unitId, id: row.id }, "Window deleted");
        }}>Delete</Button> : <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

function Schedules({ detail, busy, act }: { detail: Detail; busy: boolean; act: Act }) {
  const [adding, setAdding] = useState<string | null>(null);
  return <>
    <div className="os-banner info">During an auto-open window the gate is <b>held open</b> and <b>phone calls are not accepted</b>. Outside every window, whitelisted callers open it. The backup time clock stays wired in parallel — keep its period the same as or shorter than these times.</div>
    {detail.units.map((u) => (
      <div className="os-card" key={u.id} style={{ marginBottom: 14 }}>
        <h3>{u.name}</h3>
        {detail.schedules.filter((w) => w.unit_id === u.id).map((w) => <WindowForm key={`${w.id}-${detail.site.config_version}`} unitId={u.id} row={w} busy={busy} act={act} />)}
        {!detail.schedules.some((w) => w.unit_id === u.id) && <p style={{ opacity: .7 }}>No auto-open window: calls accepted 24/7.</p>}
        {adding === u.id ? <WindowForm unitId={u.id} busy={busy} act={act} onCancel={() => setAdding(null)} />
          : <Button size="sm" variant="outline" style={{ marginTop: 8 }} onClick={() => setAdding(u.id)}><Plus /> Add window</Button>}
      </div>
    ))}
  </>;
}

function CallTable({ calls, units }: { calls: Call[] | null; units: Unit[] }) {
  if (!calls) return <div className="os-row"><LoaderCircle className="animate-spin" /> Loading…</div>;
  const uname = (id: string) => units.find((u) => u.id === id)?.name ?? "?";
  const tone = (r: string) => r === "opened" ? "os-ok" : ["refused_window", "debounced"].includes(r) ? "os-mute" : ["no_caller_id", "rate_limited"].includes(r) ? "os-warn" : "os-bad";
  return <div className="os-scroll"><table className="os-table">
    <thead><tr><th>Time</th><th>Gate</th><th>Caller</th><th>Mobile</th><th>Result</th><th>Detail</th></tr></thead>
    <tbody>{calls.length ? calls.map((c) => (
      <tr key={c.id}><td>{fmt(c.occurred_at)}</td><td>{uname(c.unit_id)}</td><td>{c.caller_name ?? "—"}</td><td className="os-mono">{localAu(c.phone_e164)}</td>
        <td><span className={`os-pill ${tone(c.result)}`}>{RESULT_LABELS[c.result] ?? c.result}</span></td><td style={{ opacity: .7 }}>{c.detail ?? ""}</td></tr>
    )) : <tr><td colSpan={6} style={{ opacity: .7 }}>No calls yet.</td></tr>}</tbody>
  </table></div>;
}

function Persons({ detail, busy, act }: { detail: Detail; busy: boolean; act: Act }) {
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [phone, setPhone] = useState("");
  return <>
    <div className="os-banner info">People who may instruct changes for this site. Pick one in “Acting on authority of” before a change; it is stamped on the Changes log.</div>
    <form className="os-form" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "person.add", name, role, phone }, "Added")) { setName(""); setRole(""); setPhone(""); } }}>
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      <Input placeholder="Role (e.g. OC manager)" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} />
      <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
      <Button type="submit" disabled={busy}>Add</Button>
    </form>
    <div className="os-scroll"><table className="os-table">
      <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th /></tr></thead>
      <tbody>{detail.persons.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.role ?? ""}</td><td>{p.phone ?? ""}</td>
        <td><Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Remove ${p.name}?`)) void act({ action: "person.delete", id: p.id }, "Removed"); }}>Remove</Button></td></tr>)}</tbody>
    </table></div>
  </>;
}

function ChangeTable({ changes }: { changes: Change[] | null }) {
  if (!changes) return <div className="os-row"><LoaderCircle className="animate-spin" /> Loading…</div>;
  const ent: Record<string, string> = { gd_whitelist: "Whitelist", gd_schedules: "Auto-open", gd_units: "Gate unit", gd_auth_persons: "Authorised person" };
  const what = (c: Change) => {
    const n = c.detail?.new ?? {}, o = c.detail?.old ?? {}, r = Object.keys(n).length ? n : o;
    if (c.entity === "gd_whitelist") return `${r.name ?? ""} ${localAu(r.phone_e164 as string)}${c.action === "update" && n.enabled !== o.enabled ? (n.enabled ? " enabled" : " disabled") : ""}`;
    if (c.entity === "gd_schedules") return `${r.name ?? ""} ${String(r.open_time ?? "").slice(0, 5)}–${String(r.close_time ?? "").slice(0, 5)}`;
    if (c.entity === "gd_units") return `${r.name ?? ""}${n.lockdown !== o.lockdown ? (n.lockdown ? " LOCKDOWN on" : " lockdown off") : ""}${n.enabled !== o.enabled ? (n.enabled ? " enabled" : " disabled") : ""}`;
    return String(r.name ?? "");
  };
  return <div className="os-scroll"><table className="os-table">
    <thead><tr><th>Time</th><th>What</th><th>Action</th><th>Detail</th><th>Authorised by</th><th>Signed in as</th></tr></thead>
    <tbody>{changes.map((c) => <tr key={c.id}><td>{fmt(c.at)}</td><td>{ent[c.entity] ?? c.entity}</td><td>{c.action}</td><td>{what(c)}</td><td>{c.authorised_by ?? ""}</td><td style={{ opacity: .7 }}>{c.actor_email ?? ""}</td></tr>)}</tbody>
  </table></div>;
}
