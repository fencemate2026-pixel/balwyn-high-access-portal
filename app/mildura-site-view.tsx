"use client";
// Owner → RJL portals → Mildura (4 Nov 2026, Jarrod): the same sections as the
// Mildura Pi's own dashboard, in the Pi's order, restyled with the portal theme.
// READ-ONLY: data is the Pi's mirror (gd_mirror_*) read server-side by the
// owner-gated /api/owner/sites?view=mirror. The cloud holds no PINs, so none are
// shown. Gate controls arrive only in Phase 2; here they are shown disabled.
import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
const PHASE2 = "Controls available after Phase 2";
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

const CSS = `
.mv-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
.mv-tile{border:1px solid var(--border,#e3e7ef);border-radius:12px;padding:12px;background:var(--card,#fff)}
.mv-tile small{display:block;opacity:.65;font-size:12px}.mv-tile b{font-size:20px}.mv-tile b.nr{font-size:13px;opacity:.6;font-weight:500}
.mv-two{display:grid;grid-template-columns:1.6fr 1fr;gap:14px}
.mv-bars{display:flex;align-items:flex-end;gap:3px;height:140px;margin-top:10px}
.mv-bar{flex:1;background:#ff6b00;border-radius:3px 3px 0 0;min-height:2px;opacity:.85}
.mv-legend{display:flex;gap:12px;font-size:12px;flex-wrap:wrap;margin-top:8px}.mv-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.mv-stack{display:flex;flex-direction:column;gap:14px;margin-top:14px}
@media (max-width:900px){.mv-tiles{grid-template-columns:repeat(2,1fr)}.mv-two{grid-template-columns:1fr}}
`;

export default function MilduraSiteView({ fixture }: { fixture?: MirrorDetail } = {}) {
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

  if (!data) return error ? <div className="os-banner warn">{error}</div> : <div className="os-row"><LoaderCircle className="animate-spin" /> Loading Mildura…</div>;
  return <MilduraBody data={data} />;
}

function MilduraBody({ data }: { data: MirrorDetail }) {
  const now = Date.parse(data.serverTime) || Date.now();
  const unit = data.units[0] ?? null;
  const on = !!unit?.last_seen && (now - Date.parse(unit.last_seen)) / 1000 < UNIT_ONLINE_SECONDS;
  const gate = gateStatus(unit?.last_status ?? null);
  const empty = !unit?.last_seen && !data.users.length && !data.access.length && !data.schedules.length && !data.persons.length;
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
  const usage = useMemo(() => usageByDay(data.access30, today), [data.access30, today]);
  const max = Math.max(1, ...usage.map((b) => b.count));
  const breakdown = useMemo(() => accessBreakdown(data.access30), [data.access30]);
  const [tab, setTab] = useState<"access" | "changes">("access");
  const [q, setQ] = useState("");
  const users = data.users.filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <style>{CSS}</style>
      {/* Header and gate status */}
      <div className="os-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>{SITE_NAME}</h2>
          <small style={{ opacity: .7 }}>Boom gate · keypad · read-only mirror of the site Pi</small>
        </div>
        <div className="os-row">
          <span className={`os-pill ${on ? "os-ok" : "os-bad"}`}>{on ? "Online" : "Offline"} · last seen {ago(unit?.last_seen ?? null, now)}</span>
          <span className={`os-pill os-${gate.tone}`}>Gate: {gate.label}</span>
        </div>
      </div>
      <div className="os-row" style={{ margin: "10px 0" }} title={PHASE2}>
        {["Open Gate", "Hold Open", "Lockdown"].map((l) => <Button key={l} size="sm" variant="outline" disabled>{l}</Button>)}
        <small style={{ opacity: .65 }}>{PHASE2}</small>
      </div>
      {empty && <div className="os-banner info"><strong>Waiting for first sync from the Mildura Pi.</strong> Nothing has been received yet.</div>}

      <div className="mv-stack">
        <section className="os-card" aria-label="Authorised persons">
          <h3>Authorised persons</h3>
          {data.persons.length ? <table className="os-table" style={{ marginTop: 8 }}><thead><tr><th>Name</th><th>Role</th></tr></thead>
            <tbody>{data.persons.map((p) => <tr key={p.local_id}><td>{p.name}</td><td>{p.role ?? ""}</td></tr>)}</tbody></table>
            : <p style={{ fontSize: 13, opacity: .7 }}>None synced yet.</p>}
        </section>

        <section className="mv-tiles" aria-label="Pi health">
          {healthTiles(unit?.last_status ?? null).map((t) => <div className="mv-tile" key={t.key}><small>{t.label}</small>{t.value ? <b>{t.value}</b> : <b className="nr">not reported</b>}</div>)}
        </section>

        <section className="os-card" aria-label="Keypad usage">
          <h3>Keypad usage <small style={{ opacity: .6, fontWeight: 400 }}>last 30 days</small></h3>
          <div className="mv-bars" role="img" aria-label={`Keypad uses per day, total ${usage.reduce((a, b) => a + b.count, 0)}`}>
            {usage.map((b) => <div key={b.day} className="mv-bar" style={{ height: `${(b.count / max) * 100}%` }} title={`${b.day}: ${b.count}`} />)}
          </div>
          <div className="os-row" style={{ justifyContent: "space-between", fontSize: 11, opacity: .6 }}><span>{usage[0].day}</span><span>{usage[usage.length - 1].day}</span></div>
        </section>

        <section className="os-card" aria-label="Site location">
          <h3><MapPin size={16} aria-hidden="true" /> Site location</h3>
          <p style={{ fontSize: 13, margin: "8px 0" }}>{SITE_NAME}<br />{MILDURA_ADDRESS}</p>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE_NAME}, ${MILDURA_ADDRESS}`)}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
        </section>

        <div className="mv-two">
          <section className="os-card" aria-label="Auto-open schedules">
            <h3>Auto-open schedules</h3>
            {data.schedules.length ? <table className="os-table" style={{ marginTop: 8 }}><thead><tr><th>Name</th><th>Days</th><th>Open</th><th>Close</th><th /></tr></thead>
              <tbody>{data.schedules.map((s) => <tr key={s.local_id}><td>{s.name}</td><td>{days(s.days)}</td><td>{String(s.open_time).slice(0, 5)}</td><td>{String(s.close_time).slice(0, 5)}</td>
                <td><span className={`os-pill ${s.enabled ? "os-ok" : "os-mute"}`}>{s.enabled ? "Enabled" : "Off"}</span></td></tr>)}</tbody></table>
              : <p style={{ fontSize: 13, opacity: .7 }}>None synced yet.</p>}
          </section>
          <section className="os-card" aria-label="Access breakdown">
            <h3>Access breakdown <small style={{ opacity: .6, fontWeight: 400 }}>30 days</small></h3>
            <Donut parts={[["Granted", breakdown.granted, "#0f9d58"], ["Denied", breakdown.denied, "#d93025"], ["Auto-open", breakdown.autoOpen, "#ff6b00"]]} />
          </section>
        </div>

        <section className="os-card" aria-label="Authorised users">
          <div className="os-row" style={{ justifyContent: "space-between" }}>
            <h3>Authorised users <span className="os-pill os-mute">{data.users.length}</span></h3>
            <div className="os-row">
              <label className="os-row" style={{ gap: 4 }}><Search size={14} aria-hidden="true" /><Input placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" style={{ width: 200 }} /></label>
              <Button size="sm" variant="outline" disabled title={PHASE2}>Add User</Button>
            </div>
          </div>
          <div className="os-scroll" style={{ marginTop: 10, maxHeight: 420, overflowY: "auto" }}><table className="os-table">
            <thead><tr><th>Name</th><th>Status</th><th>Schedule</th><th>Added</th></tr></thead>
            <tbody>{users.length ? users.map((u) => <tr key={u.local_id}><td>{u.name}</td>
              <td><span className={`os-pill ${u.enabled ? "os-ok" : "os-bad"}`}>{u.enabled ? "Enabled" : "Disabled"}</span></td>
              <td><span className={`os-pill ${!u.schedule_type || u.schedule_type === "always" ? "os-mute" : "os-warn"}`}>{u.schedule_type ? u.schedule_type.replace(/_/g, " ") : "always"}</span></td>
              <td style={{ opacity: .7 }}>{local(u.created_at_local)}</td></tr>)
              : <tr><td colSpan={4} style={{ opacity: .7 }}>{data.users.length ? "No user matches that search." : "Waiting for first sync from the Mildura Pi."}</td></tr>}</tbody>
          </table></div>
        </section>

        <section>
          <div className="os-tabs" role="tablist">
            {([["access", "Access log"], ["changes", "Changes log"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`os-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === "access" ? <div className="os-scroll"><table className="os-table">
            <thead><tr><th>Time (site)</th><th>User</th><th>Method</th><th>Result</th></tr></thead>
            <tbody>{data.access.length ? data.access.map((a, i) => <tr key={a.local_id ?? i}><td>{local(a.occurred_at_local)}</td><td>{a.user_name ?? "Unknown"}</td><td>{a.method ?? ""}</td>
              <td><span className={`os-pill ${a.success ? "os-ok" : "os-bad"}`}>{a.success ? "Granted" : "Denied"}</span></td></tr>)
              : <tr><td colSpan={4} style={{ opacity: .7 }}>Waiting for first sync from the Mildura Pi.</td></tr>}</tbody></table></div>
          : <div className="os-scroll"><table className="os-table">
            <thead><tr><th>Time (site)</th><th>Action</th><th>Detail</th><th>By</th></tr></thead>
            <tbody>{data.changes.length ? data.changes.map((c) => <tr key={c.local_id}><td>{local(c.occurred_at_local)}</td><td>{c.action}</td><td>{c.detail ?? ""}</td><td style={{ opacity: .7 }}>{c.changed_by ?? ""}</td></tr>)
              : <tr><td colSpan={4} style={{ opacity: .7 }}>Waiting for first sync from the Mildura Pi.</td></tr>}</tbody></table></div>}
        </section>
      </div>
    </div>
  );
}

function Donut({ parts }: { parts: [string, number, string][] }) {
  const total = parts.reduce((a, p) => a + p[1], 0);
  const r = 42, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="os-row" style={{ marginTop: 8, gap: 16 }}>
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={parts.map((p) => `${p[0]} ${p[1]}`).join(", ")}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(127,127,127,.2)" strokeWidth="16" />
        {total > 0 && parts.map(([l, v, col]) => { const len = (v / total) * c; const el = <circle key={l} cx="60" cy="60" r={r} fill="none" stroke={col} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />; off += len; return el; })}
        <text x="60" y="65" textAnchor="middle" fontSize="16" fontWeight="700" fill="currentColor">{total}</text>
      </svg>
      <div className="mv-legend" style={{ flexDirection: "column" }}>{parts.map(([l, v, col]) => <span key={l}><i style={{ background: col }} />{l}: {v}</span>)}</div>
    </div>
  );
}
