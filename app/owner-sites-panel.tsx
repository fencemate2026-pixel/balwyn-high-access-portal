"use client";
// Owner → Sites. 30 Oct 2026 (Jarrod): the Magic Keys owner's own console for every RJL GSM gate
// dialler site. Rebuilt 4 Nov 2026 in the same numbered-section layout and navy theme as Mildura.
// Everything saves straight to Supabase (gd_* tables) through /api/owner/sites; online gate units
// pick the change up within a couple of seconds. No PINs: access is by caller phone number.
// Shown only to the verified owner; /api/owner/sites re-checks that on every request, so hiding
// this component is presentation, not security.
// No "delete all": one click must never be able to wipe a whitelist. Every delete asks first.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, Download, ExternalLink, History, LoaderCircle, MapPin, Pencil, Plus, Power, RefreshCw, Search, ShieldCheck, Trash2, Upload, UserCheck, Users, Cpu } from "lucide-react";
import type { OwnerSiteLink } from "@/lib/owner-sites-links";
import { toast } from "sonner";
import { OWNER_SITES_CSS } from "./owner-sites-css";
import MilduraSiteView from "./mildura-site-view";
import ThomastownSwingView from "./thomastown-swing-view";
import { isGdSiteId, type GdSiteId } from "@/lib/gd-swing-model";
import { ConfirmDialog, FIELD_STYLE, INPUT, type ConfirmSpec } from "./mildura-controls";
import { GLASS_PANEL, GLASS_TILE, glassButton } from "./glass-ui";
import { Empty, MUTED, Navy, Pill, Section, TD, TH, Td, downloadCsv, stampDay } from "./site-section-ui";
import { RESULT_LABELS, UNIT_ONLINE_SECONDS, WHITELIST_IMPORT_MAX, localAu } from "@/lib/owner-sites-model";
import { parseWhitelistCsv, toCsv, type WhitelistCsvRow } from "@/lib/owner-csv";

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
type LogTab = "calls" | "changes";
type Act = (body: Record<string, unknown>, done: string) => Promise<boolean>;
type Ask = (spec: ConfirmSpec) => Promise<boolean>;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TZ = "Australia/Melbourne";
const fmt = (ts: string | null) => ts ? new Date(ts).toLocaleString("en-AU", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const ago = (ts: string | null, now: number) => {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const online = (u: { last_seen: string | null }, now: number) => !!u.last_seen && (now - Date.parse(u.last_seen)) / 1000 < UNIT_ONLINE_SECONDS;

async function api<T>(init?: { body?: Record<string, unknown>; query?: string }): Promise<T> {
  const res = await fetch(`/api/owner/sites${init?.query ?? ""}`, init?.body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body), credentials: "same-origin" }
    : { credentials: "same-origin", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed.");
  return data as T;
}

// onOpenPortal: switch the dashboard to a view of this portal (Balwyn) in place.
// selectedId + hideList: the dashboard sidebar owns the site list and tells this panel which
// site to show (a gd_* site slug, or the id of a linked site such as Mildura). Without them
// the panel keeps its own list, as before.
export default function OwnerSitesPanel({ onOpenPortal, selectedId, hideList = false }: { onOpenPortal?: () => void; selectedId?: string | null; hideList?: boolean } = {}) {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [links, setLinks] = useState<OwnerSiteLink[]>([]);
  const [slugState, setSlugState] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [logTab, setLogTab] = useState<LogTab>("calls");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState("");
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [callUnit, setCallUnit] = useState("");
  const [callResult, setCallResult] = useState("");
  const [confirm, setConfirm] = useState<(ConfirmSpec & { resolve: (ok: boolean) => void }) | null>(null);
  // The chosen site: the sidebar's choice when it supplies one, otherwise the panel's own.
  const picked = selectedId ?? slugState;
  const linked = links.find((l): l is Extract<OwnerSiteLink, { kind: "external" }> => l.id === picked && l.kind === "external") ?? null;
  const swing: GdSiteId | null = isGdSiteId(picked) ? picked : null;       // Azure-backed view, not a Supabase gd_* site
  const slug = linked || swing ? null : picked;

  const ask: Ask = useCallback((spec) => new Promise<boolean>((resolve) => setConfirm({ ...spec, resolve })), []);

  const loadSites = useCallback(async () => {
    const data = await api<{ sites: SiteRow[]; links?: OwnerSiteLink[] }>();
    setSites(data.sites); setLinks(data.links ?? []);
    setSlugState((current) => current ?? data.sites.find((s) => s.slug === "thomastown")?.slug ?? data.sites[0]?.slug ?? null);
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

  // One loader for everything on screen. It runs from timer callbacks (never synchronously inside
  // the effect), immediately and then every 5 s while the page is visible: unit health, applied
  // version and new calls stay live. Only the log that is showing is fetched.
  useEffect(() => {
    let first = true;
    const run = () => {
      if (!first && document.hidden) return;
      const loud = first; first = false;
      const report = (e: Error) => { if (loud) toast.error(e.message); };
      loadSites().catch(report);
      if (!slug || slug === "mildura") return; // Mildura loads its own read-only mirror view.
      loadDetail(slug).catch(report);
      if (logTab === "calls") loadCalls(slug).catch(report); else loadChanges(slug).catch(report);
    };
    const kick = setTimeout(run, 0);
    const timer = setInterval(run, 5000);
    return () => { clearTimeout(kick); clearInterval(timer); };
  }, [slug, logTab, loadSites, loadDetail, loadCalls, loadChanges]);
  // The person this change is made for; defaults to the first authorised person.
  const actingName = acting || detail?.persons[0]?.name || "";

  const act: Act = useCallback(async (body, done) => {
    if (!detail) return false;
    setBusy(true);
    try {
      const data = await api<Detail>({ body: { ...body, site: detail.site.slug, authorisedBy: actingName || undefined } });
      setDetail(data); toast.success(done); loadSites().catch(() => undefined);
      if (logTab === "changes") loadChanges(detail.site.slug).catch(() => undefined);
      return true;
    } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  }, [detail, actingName, logTab, loadSites, loadChanges]);

  /** Add many numbers: sent in batches the server accepts, reporting one combined result. */
  const importRows = useCallback(async (rows: WhitelistCsvRow[]) => {
    if (!detail) return null;
    setBusy(true);
    let added = 0, skipped = 0;
    try {
      for (let i = 0; i < rows.length; i += WHITELIST_IMPORT_MAX) {
        const out = await api<Detail & { imported?: { added: number; skipped: number } }>({ body: {
          action: "whitelist.import", site: detail.site.slug, authorisedBy: actingName || undefined, rows: rows.slice(i, i + WHITELIST_IMPORT_MAX),
        } });
        added += out.imported?.added ?? 0; skipped += out.imported?.skipped ?? 0;
        setDetail(out);
      }
      toast.success(`Imported ${added} number${added === 1 ? "" : "s"}${skipped ? `, ${skipped} already on the list` : ""}.`);
      loadSites().catch(() => undefined);
      return { added, skipped };
    } catch (e) {
      toast.error(`${(e as Error).message}${added ? ` (${added} were added before this stopped.)` : ""}`);
      return null;
    } finally { setBusy(false); }
  }, [detail, actingName, loadSites]);

  if (!sites) return <div className="os-row"><LoaderCircle className="animate-spin" /> Loading sites…</div>;
  if (!sites.length) return <p>No sites yet.</p>;

  const dot = (s: SiteRow) => !s.gd_units.length ? "" : s.gd_units.some((u) => !online(u, now)) ? "bad"
    : s.gd_units.some((u) => u.applied_version < s.config_version || u.lockdown) ? "warn" : "ok";

  return (
    <section className={`os-wrap${hideList ? " os-solo" : ""}`} aria-label="Owner sites">
      <style>{OWNER_SITES_CSS}</style>
      {!hideList && <nav className="os-list" aria-label="Sites">
        <h4>My sites</h4>
        {sites.map((s) => (
          <button key={s.id} type="button" className={`os-site ${s.slug === slug ? "on" : ""}`} onClick={() => { setSlugState(s.slug); setCalls(null); setChanges(null); }}>
            <span className={`os-dot ${dot(s)}`} />
            <span>{s.name}<small>{s.gd_units.length} gate unit{s.gd_units.length === 1 ? "" : "s"}</small></span>
          </button>
        ))}
        {links.length > 0 && <h4 className="os-gap">Other sites</h4>}
        {links.map((l) => l.kind === "view"
          ? <button key={l.id} type="button" className={`os-site ${picked === l.id ? "on" : ""}`} onClick={() => setSlugState(l.id)}>
              <span className="os-dot" /><span>{l.name}<small>{l.detail}</small></span>
            </button>
          : l.kind === "portal"
          ? <button key={l.id} type="button" className="os-site" onClick={() => onOpenPortal?.()} title="Open this portal's campus dashboard">
              <span className="os-dot ok" /><span>{l.name}<small>{l.detail}</small></span>
            </button>
          : <a key={l.id} className="os-site" href={l.url} target="_blank" rel="noopener noreferrer" title={l.note}>
              {/* Not monitored from here, so a neutral dot rather than online/offline. */}
              <span className="os-dot" /><span>{l.name}<small>{l.detail}</small><small>{l.note}</small></span>
              <ExternalLink className="os-ext" aria-label="Opens in a new tab" />
            </a>)}
      </nav>}
      <div>
        {swing ? <ThomastownSwingView key={swing} device={swing} /> : linked ? <LinkedSitePanel link={linked} /> : slug === "mildura" ? <MilduraSiteView /> : !detail ? <div className="os-row"><LoaderCircle className="animate-spin" /> Loading…</div>
          : <SiteBody detail={detail} now={now} busy={busy} act={act} ask={ask} importRows={importRows} actingName={actingName} setActing={setActing}
              logTab={logTab} setLogTab={(t) => { setLogTab(t); }} calls={calls} changes={changes} callUnit={callUnit} setCallUnit={setCallUnit}
              callResult={callResult} setCallResult={setCallResult} reloadCalls={() => slug && loadCalls(slug)} />}
      </div>
      {confirm && <ConfirmDialog spec={confirm} onClose={(ok) => { confirm.resolve(ok); setConfirm(null); }} />}
    </section>
  );
}

type BodyProps = {
  detail: Detail; now: number; busy: boolean; act: Act; ask: Ask; importRows: (rows: WhitelistCsvRow[]) => Promise<{ added: number; skipped: number } | null>;
  actingName: string; setActing: (v: string) => void; logTab: LogTab; setLogTab: (t: LogTab) => void; calls: Call[] | null; changes: Change[] | null;
  callUnit: string; setCallUnit: (v: string) => void; callResult: string; setCallResult: (v: string) => void; reloadCalls: () => void;
};

function SiteBody(p: BodyProps) {
  const { detail, now, busy, act, ask } = p;
  const active = detail.whitelist.filter((w) => w.enabled).length;
  const mapQuery = detail.site.address ? `${detail.site.name}, ${detail.site.address}` : "";
  return (
    <div className="mildura-view">
      {/* 1. Header and site status */}
      <section className="gate-condition mb-4" aria-label={`${detail.site.name} status`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 flex items-center gap-2 text-lg"><ShieldCheck className="size-4 text-[#FF7A00]" aria-hidden="true" /> {detail.site.name}</h2>
          <span className="connection-pill"><i /> Owner control · saves to Supabase</span>
        </div>
        <Navy>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="gate-ordinal grid size-9 place-items-center rounded-none border border-[#FF7A00] bg-[#FF7A00] text-xs font-bold text-white" aria-hidden="true">01</span>
              <div><h3 className="m-0 text-sm font-semibold">{detail.units.length} gate unit{detail.units.length === 1 ? "" : "s"} · {active} active number{active === 1 ? "" : "s"}</h3>
                <p className={`m-0 mt-1 text-[11px] ${MUTED}`}>{detail.site.address ?? "No address set"} · config v{detail.site.config_version}</p></div>
            </div>
            <label className="flex items-center gap-2 text-xs"><span className={MUTED}>Acting on authority of</span>
              <select style={FIELD_STYLE} className={`${INPUT} !w-auto min-w-40`} value={p.actingName} onChange={(e) => p.setActing(e.target.value)} aria-label="Acting on authority of">
                {detail.persons.length ? detail.persons.map((x) => <option key={x.id} value={x.name}>{x.name}</option>) : <option value="">Myself</option>}
              </select></label>
          </div>
          <PendingBanner detail={detail} now={now} busy={busy} onAck={async () => {
            if (await ask({ title: "Send the reduced whitelist to the gates?", body: "Removed numbers will stop opening the gate.", action: "Confirm removal" })) void act({ action: "site.ackShrink", seenVersion: detail.site.config_version }, "Large removal confirmed");
          }} />
        </Navy>
      </section>

      {/* 2. Authorised persons */}
      <PersonsSection detail={detail} busy={busy} act={act} ask={ask} />

      {/* 3. Gate units */}
      <Section n={3} icon={Cpu} title="Gate units" label="Gate units" right={<span className="text-xs text-muted-foreground">Refreshes every 5 s</span>}>
        <Units detail={detail} now={now} busy={busy} act={act} ask={ask} />
      </Section>

      {/* 4. Site location */}
      <Section n={4} icon={MapPin} title="Site location" label="Site location">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm">{detail.site.name}<br /><span className={MUTED}>{detail.site.address ?? "No address set"}</span></p>
          {mapQuery && <a className={glassButton()} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer"><MapPin className="size-4" aria-hidden="true" /> Open in Google Maps</a>}
        </div>
      </Section>

      {/* 5. Auto-open times */}
      <SchedulesSection detail={detail} busy={busy} act={act} ask={ask} />

      {/* 6. Whitelist */}
      <WhitelistSection detail={detail} busy={busy} act={act} ask={ask} importRows={p.importRows} />

      {/* 7. Call log / Changes log */}
      <Section n={7} icon={History} title={p.logTab === "calls" ? "Call log" : "Changes log"} label="Logs" right={<div className="flex flex-wrap items-center gap-2" role="tablist">
        {p.logTab === "calls" && <>
          <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} value={p.callUnit} onChange={(e) => p.setCallUnit(e.target.value)} aria-label="Gate">
            <option value="">All gates</option>{detail.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} value={p.callResult} onChange={(e) => p.setCallResult(e.target.value)} aria-label="Result">
            <option value="">All results</option>{Object.entries(RESULT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button type="button" className={glassButton()} onClick={p.reloadCalls}><RefreshCw className="size-4" /> Refresh</button></>}
        <button type="button" className={glassButton()} disabled={p.logTab === "calls" ? !p.calls?.length : !p.changes?.length} onClick={() => downloadCsv(`${detail.site.slug}-${p.logTab}-log-${stampDay()}.csv`, p.logTab === "calls"
          ? toCsv(["Time", "Gate", "Caller", "Mobile", "Result", "Detail"], (p.calls ?? []).map((c) => [fmt(c.occurred_at), detail.units.find((u) => u.id === c.unit_id)?.name ?? "?", c.caller_name ?? "", localAu(c.phone_e164), RESULT_LABELS[c.result] ?? c.result, c.detail ?? ""]))
          : toCsv(["Time", "What", "Action", "Detail", "Authorised by", "Signed in as"], (p.changes ?? []).map((c) => [fmt(c.at), ENTITY[c.entity] ?? c.entity, c.action, changeWhat(c), c.authorised_by ?? "", c.actor_email ?? ""])))}><Download className="size-4" /> Export</button>
        {(["calls", "changes"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={p.logTab === k} className={glassButton(p.logTab === k ? "orange" : "glass")} onClick={() => p.setLogTab(k)}>{k === "calls" ? "Call log" : "Changes log"}</button>)}
      </div>}>
        <div className="max-h-[520px] overflow-auto">{p.logTab === "calls" ? <CallTable calls={p.calls} units={detail.units} /> : <ChangeTable changes={p.changes} />}</div>
        {p.logTab === "calls" && <small className={`mt-2 block ${MUTED}`}>Latest 300 · refreshes every 5 s</small>}
      </Section>
    </div>
  );
}

function PendingBanner({ detail, now, busy, onAck }: { detail: Detail; now: number; busy: boolean; onAck: () => void }) {
  const waiting = detail.units.filter((u) => u.applied_version < detail.site.config_version);
  if (!waiting.length) return null;
  const refused = waiting.some((u) => u.last_status?.sync?.refused_version);
  return (
    <div className={`${GLASS_TILE} mt-4 border-[#fbbf24] p-3 text-sm`}>
      <b className="text-[#fbbf24]">Waiting:</b> <span>{waiting.map((u) => u.name).join(", ")} {waiting.length > 1 ? "have" : "has"} not applied the latest change yet
      {waiting.some((u) => !online(u, now)) ? " (offline — it applies when the unit reconnects)" : ""}.</span>
      {refused && <> <span>A unit refused a large whitelist removal (over 10 %).</span> <button type="button" className={`${glassButton("orange")} ml-2 h-8`} disabled={busy} onClick={onAck}>Confirm large removal</button></>}
    </div>
  );
}

/** Small labelled inputs shared by the inline forms. */
function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-xs ${className}`}><span className={MUTED}>{label}</span>{children}</label>;
}

// ---------------------------------------------------------------- 2. persons
function PersonsSection({ detail, busy, act, ask }: { detail: Detail; busy: boolean; act: Act; ask: Ask }) {
  const [form, setForm] = useState<null | "add" | string>(null);
  return (
    <Section n={2} icon={UserCheck} title="Authorised persons" right={<button type="button" className={glassButton("orange")} disabled={busy} onClick={() => setForm("add")}><Plus className="size-4" /> Add person</button>}>
      <p className={`m-0 mb-3 text-xs ${MUTED}`}>People who may instruct changes for this site. Pick one in “Acting on authority of” before a change; it is stamped on the Changes log.</p>
      {form && <PersonForm key={form} person={form === "add" ? undefined : detail.persons.find((x) => x.id === form)} busy={busy} act={act} onDone={() => setForm(null)} />}
      {detail.persons.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{detail.persons.map((x) =>
        <div key={x.id} className={`${GLASS_TILE} flex items-start justify-between gap-2 p-3`}>
          <div><strong className="block text-sm">{x.name}</strong><small className={MUTED}>{x.role ?? "—"}{x.phone ? ` · ${x.phone}` : ""}</small></div>
          <div className="flex gap-1">
            <button type="button" className={`${glassButton()} h-8`} aria-label={`Edit ${x.name}`} disabled={busy} onClick={() => setForm(x.id)}><Pencil className="size-4" /></button>
            <button type="button" className={`${glassButton()} h-8`} aria-label={`Remove ${x.name}`} disabled={busy}
              onClick={async () => { if (await ask({ title: `Remove ${x.name}?`, body: "They are taken off this site's list of authorised persons.", action: "Remove person" })) void act({ action: "person.delete", id: x.id }, "Removed"); }}><Trash2 className="size-4" /></button>
          </div></div>)}</div> : <Empty text="No authorised persons yet." />}
    </Section>
  );
}

function PersonForm({ person, busy, act, onDone }: { person?: Person; busy: boolean; act: Act; onDone: () => void }) {
  const [name, setName] = useState(person?.name ?? ""); const [role, setRole] = useState(person?.role ?? ""); const [phone, setPhone] = useState(person?.phone ?? "");
  return <form className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-4`} aria-label={person ? `Edit ${person.name}` : "Add authorised person"}
    onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await act({ action: person ? "person.update" : "person.add", id: person?.id, name, role, phone }, person ? "Saved" : "Added")) onDone(); }}>
    <Field label="Name"><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></Field>
    <Field label="Role (e.g. OC manager)"><input style={FIELD_STYLE} className={INPUT} value={role} maxLength={60} onChange={(e) => setRole(e.target.value)} /></Field>
    <Field label="Phone (optional)"><input style={FIELD_STYLE} className={INPUT} value={phone} maxLength={30} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
    <div className="flex items-end gap-2"><button type="submit" className={glassButton("orange")} disabled={busy}>{person ? "Save changes" : "Add person"}</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

// ---------------------------------------------------------------- 3. gate units
function Units({ detail, now, busy, act, ask }: { detail: Detail; now: number; busy: boolean; act: Act; ask: Ask }) {
  const [edit, setEdit] = useState<null | { id: string; what: "sim" | "key" }>(null);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {detail.units.map((u) => {
        const st = u.last_status ?? {}, g = st.gsm ?? {}, on = online(u, now), applied = u.applied_version >= detail.site.config_version;
        const windows = detail.schedules.filter((w) => w.unit_id === u.id && w.enabled);
        const kv: [string, React.ReactNode][] = [
          ["Last contact", ago(u.last_seen, now)],
          ["Network", g.registered ? `${g.operator ?? "registered"} · signal ${g.csq ?? "?"}/31` : <b className="text-[#ff6b6b]">not registered</b>],
          ["Caller ID armed", g.clip_armed ? "yes" : "no"],
          ["Relays", st.checks?.relay_ready ? "ready" : <b className="text-[#ff6b6b]">not ready</b>],
          ["Numbers on unit", st.whitelist_enabled ?? "—"],
          ["Calls to upload", st.outbox ?? "—"],
          ["Auto-open", windows.length ? windows.map((w) => `${w.name} ${w.open_time.slice(0, 5)}–${w.close_time.slice(0, 5)}`).join(" · ") : "none (calls 24/7)"],
          ["SIM number", u.sim_number ?? "—"],
          ["Pulse", `${u.pulse_seconds} s`],
          ["Device key", u.has_device_key ? <Pill tone="ok" caps>set</Pill> : <Pill tone="warn" caps>not set</Pill>],
          ["Software", u.fw_version ?? "—"],
        ];
        return (
          <article className={`${GLASS_TILE} p-4`} key={u.id}>
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold"><span className={`os-dot ${on ? "ok" : "bad"}`} />{u.name}</h3>
            <div className="os-mono">{u.device_id}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill tone={on ? "ok" : "bad"} caps>{on ? "Online" : "Offline"}</Pill>
              <Pill tone={applied ? "ok" : "warn"} caps>{applied ? `Applied v${u.applied_version}` : `Waiting (has v${u.applied_version})`}</Pill>
              {u.lockdown && <Pill tone="bad" caps>Lockdown</Pill>}
              {!u.enabled && <Pill tone="bad" caps>Disabled</Pill>}
              {st.hold_on && <Pill tone="warn" caps>Held open</Pill>}
              {st.dry_run && <Pill tone="warn" caps>Dry run</Pill>}
            </div>
            <dl className="my-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[13px]">
              {kv.map(([k, v]) => <div key={k} className="contents"><dt className={MUTED}>{k}</dt><dd className="m-0"><span>{v}</span></dd></div>)}
            </dl>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={glassButton(u.lockdown ? "orange" : "glass")} disabled={busy} onClick={async () => {
                if (!u.lockdown && !await ask({ title: `Lock down ${u.name}?`, body: "No phone call will open it and the auto-open hold is released (the backup time clock can still hold it open).", action: "Lock down" })) return;
                void act({ action: "unit.update", unitId: u.id, lockdown: !u.lockdown }, u.lockdown ? "Lockdown ended" : "Lockdown on");
              }}>{u.lockdown ? "End lockdown" : "Lockdown"}</button>
              <button type="button" className={glassButton()} disabled={busy} onClick={async () => {
                if (u.enabled && !await ask({ title: `Disable ${u.name}?`, body: "It will refuse every call until re-enabled.", action: "Disable unit" })) return;
                void act({ action: "unit.update", unitId: u.id, enabled: !u.enabled }, u.enabled ? "Unit disabled" : "Unit enabled");
              }}><Power className="size-4" /> {u.enabled ? "Disable unit" : "Enable unit"}</button>
              <button type="button" className={glassButton()} disabled={busy} onClick={() => setEdit({ id: u.id, what: "sim" })}>Edit SIM / pulse</button>
              <button type="button" className={glassButton()} disabled={busy} onClick={() => setEdit({ id: u.id, what: "key" })}>{u.has_device_key ? "Replace device key" : "Set device key"}</button>
            </div>
            {edit?.id === u.id && edit.what === "sim" && <UnitSimForm unit={u} busy={busy} act={act} onDone={() => setEdit(null)} />}
            {edit?.id === u.id && edit.what === "key" && <UnitKeyForm unit={u} busy={busy} act={act} onDone={() => setEdit(null)} />}
          </article>
        );
      })}
      <p className={`m-0 text-xs md:col-span-2 ${MUTED}`}>Changes reach an online gate in about 1–2 seconds. “Applied” means that gate has confirmed it is using the latest list and times.</p>
    </div>
  );
}

function UnitSimForm({ unit, busy, act, onDone }: { unit: Unit; busy: boolean; act: Act; onDone: () => void }) {
  const [sim, setSim] = useState(unit.sim_number ?? ""); const [pulse, setPulse] = useState(String(unit.pulse_seconds));
  return <form className="mt-3 grid grid-cols-[1fr_120px_auto] items-end gap-2" aria-label={`Edit ${unit.name} SIM and pulse`}
    onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "unit.update", unitId: unit.id, simNumber: sim, pulseSeconds: Number(pulse) }, "Saved")) onDone(); }}>
    <Field label="SIM number"><input style={FIELD_STYLE} className={INPUT} value={sim} inputMode="tel" onChange={(e) => setSim(e.target.value)} /></Field>
    <Field label="Pulse (0.2–3 s)"><input style={FIELD_STYLE} className={INPUT} type="number" step="0.1" min={0.2} max={3} value={pulse} onChange={(e) => setPulse(e.target.value)} required /></Field>
    <div className="flex gap-2"><button type="submit" className={glassButton("orange")} disabled={busy}>Save</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

function UnitKeyForm({ unit, busy, act, onDone }: { unit: Unit; busy: boolean; act: Act; onDone: () => void }) {
  const [fp, setFp] = useState("");
  return <form className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2" aria-label={`Device key for ${unit.name}`}
    onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "unit.update", unitId: unit.id, deviceKeyFingerprint: fp.trim() }, "Device key set — the unit should come online within seconds")) onDone(); }}>
    <Field label="64-character device key fingerprint printed by install.sh on this unit"><input style={FIELD_STYLE} className={`${INPUT} font-mono`} value={fp} maxLength={64} autoComplete="off" spellCheck={false} onChange={(e) => setFp(e.target.value)} required /></Field>
    <div className="flex gap-2"><button type="submit" className={glassButton("orange")} disabled={busy || fp.trim().length !== 64}>Save key</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

// ---------------------------------------------------------------- 5. auto-open times
function WindowForm({ unitId, row, busy, act, onCancel }: { unitId: string; row?: Window; busy: boolean; act: Act; onCancel: () => void }) {
  const [name, setName] = useState(row?.name ?? "Daily hold open");
  const [open, setOpen] = useState(row?.open_time.slice(0, 5) ?? "06:00");
  const [close, setClose] = useState(row?.close_time.slice(0, 5) ?? "18:00");
  const [span, setSpan] = useState(row?.span_days ?? 0);
  const [days, setDays] = useState<number[]>(row?.days ?? [1, 2, 3, 4, 5, 6, 7]);
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  return (
    <form className={`${GLASS_TILE} mt-2 grid gap-3 p-3`} aria-label={row ? `Edit ${row.name}` : "Add auto-open window"}
      onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "schedule.save", unitId, id: row?.id, name, openTime: open, closeTime: close, spanDays: span, days, enabled }, "Auto-open times saved")) onCancel(); }}>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <Field label="Name"><input style={FIELD_STYLE} className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></Field>
        <Field label="Opens"><input style={FIELD_STYLE} className={INPUT} type="time" value={open} onChange={(e) => setOpen(e.target.value)} required /></Field>
        <Field label="Closes"><input style={FIELD_STYLE} className={INPUT} type="time" value={close} onChange={(e) => setClose(e.target.value)} required /></Field>
        <Field label="+days (Fri open → Mon close = 3)"><input style={FIELD_STYLE} className={`${INPUT} w-24`} type="number" min={0} max={6} value={span} onChange={(e) => setSpan(Number(e.target.value))} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days">
        {DAYS.map((d, i) => { const on = days.includes(i + 1); return <button key={d} type="button" aria-pressed={on} className={`${glassButton(on ? "orange" : "glass")} h-8 min-w-11 px-2 text-xs`} onClick={() => setDays(on ? days.filter((x) => x !== i + 1) : [...days, i + 1].sort())}>{d}</button>; })}
        <label className="ml-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <span>Enabled</span></label>
      </div>
      <div className="flex gap-2"><button type="submit" className={glassButton("orange")} disabled={busy || !days.length}>Save</button><button type="button" className={glassButton()} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function SchedulesSection({ detail, busy, act, ask }: { detail: Detail; busy: boolean; act: Act; ask: Ask }) {
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Section n={5} icon={CalendarClock} title="Auto-open times" label="Auto-open times">
      <p className={`m-0 mb-3 text-xs ${MUTED}`}>During an auto-open window the gate is <b>held open</b> and <b>phone calls are not accepted</b>. Outside every window, whitelisted callers open it. The backup time clock stays wired in parallel — keep its period the same as or shorter than these times.</p>
      {detail.units.map((u) => (
        <div className={`${GLASS_TILE} mb-3 p-3`} key={u.id}>
          <h3 className="m-0 text-sm font-semibold">{u.name}</h3>
          {detail.schedules.filter((w) => w.unit_id === u.id).map((w) => editing === w.id
            ? <WindowForm key={`${w.id}-${detail.site.config_version}`} unitId={u.id} row={w} busy={busy} act={act} onCancel={() => setEditing(null)} />
            : <div key={w.id} className={`mt-2 flex flex-wrap items-center justify-between gap-2 border p-3 ${w.enabled ? "border-[#FF7A00] bg-[#FF7A00]/[0.12]" : "border-white/[0.14]"}`}>
                <div><strong className="text-sm">{w.name}</strong> <Pill tone={w.enabled ? "ok" : "mute"} caps>{w.enabled ? "Active" : "Off"}</Pill>
                  <p className="m-0 mt-1 text-xl font-bold tabular-nums">{w.open_time.slice(0, 5)} – {w.close_time.slice(0, 5)}{w.span_days ? ` (+${w.span_days} d)` : ""}</p>
                  <small className={MUTED}>{w.days.map((d) => DAYS[d - 1]).join(" ")}</small></div>
                <div className="flex gap-2">
                  <button type="button" className={`${glassButton()} h-8`} disabled={busy} onClick={() => void act({ action: "schedule.save", unitId: u.id, id: w.id, name: w.name, openTime: w.open_time.slice(0, 5), closeTime: w.close_time.slice(0, 5), spanDays: w.span_days, days: w.days, enabled: !w.enabled }, w.enabled ? "Window turned off" : "Window turned on")}><Power className="size-4" /> {w.enabled ? "Disable" : "Enable"}</button>
                  <button type="button" className={`${glassButton()} h-8`} aria-label={`Edit ${w.name}`} disabled={busy} onClick={() => setEditing(w.id)}><Pencil className="size-4" /></button>
                  <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${w.name}`} disabled={busy}
                    onClick={async () => { if (await ask({ title: `Delete "${w.name}"?`, body: "This auto-open window is removed from the gate.", action: "Delete window" })) void act({ action: "schedule.delete", unitId: u.id, id: w.id }, "Window deleted"); }}><Trash2 className="size-4" /></button>
                </div></div>)}
          {!detail.schedules.some((w) => w.unit_id === u.id) && <p className={`m-0 mt-2 text-sm ${MUTED}`}>No auto-open window: calls accepted 24/7.</p>}
          {adding === u.id ? <WindowForm unitId={u.id} busy={busy} act={act} onCancel={() => setAdding(null)} />
            : <button type="button" className={`${glassButton()} mt-3`} disabled={busy} onClick={() => setAdding(u.id)}><Plus className="size-4" /> Add window</button>}
        </div>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------- 6. whitelist
function WhitelistSection({ detail, busy, act, ask, importRows }: { detail: Detail; busy: boolean; act: Act; ask: Ask; importRows: BodyProps["importRows"] }) {
  const [q, setQ] = useState(""); const [status, setStatus] = useState<"all" | "on" | "off">("all"); const [sort, setSort] = useState<"unit" | "name" | "status">("unit");
  const [form, setForm] = useState<null | "add" | string>(null);
  const [pending, setPending] = useState<null | { rows: WhitelistCsvRow[]; problems: string[]; file: string }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    return detail.whitelist
      .filter((w) => (status === "all" || (status === "on") === w.enabled) && (!f || [w.name, w.unit_label ?? "", w.phone_e164, localAu(w.phone_e164)].join(" ").toLowerCase().includes(f)))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "status" ? Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)
        : (a.unit_label ?? "￿").localeCompare(b.unit_label ?? "￿", "en", { numeric: true }) || a.name.localeCompare(b.name));
  }, [q, status, sort, detail.whitelist]);
  const activeCount = detail.whitelist.filter((w) => w.enabled).length;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 512 * 1024) { toast.error("That file is too big. Use a CSV under 500 KB."); return; }
    const { rows: parsed, problems } = parseWhitelistCsv(await file.text());
    if (!parsed.length) { toast.error(problems[0] ?? "No numbers found in that file."); return; }
    setPending({ rows: parsed, problems, file: file.name });
  };

  return (
    <Section n={6} icon={Users} title="Whitelist" label="Whitelist" right={<div className="flex flex-wrap items-center gap-2">
      <span className="connection-pill"><i /> {activeCount} active of {detail.whitelist.length}</span>
      <label className={`${GLASS_PANEL} flex h-9 items-center gap-2 px-3`}><Search className="size-4 text-[#5CC8FF]" aria-hidden="true" />
        <input className="w-44 bg-transparent text-sm text-[#F5FBFF] outline-none placeholder:text-[#B9CFE2]" placeholder="Search name, unit or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search whitelist" /></label>
      <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
        <option value="all">All statuses</option><option value="on">Active only</option><option value="off">Disabled only</option></select>
      <select style={FIELD_STYLE} className={`${INPUT} !w-auto`} aria-label="Sort whitelist" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
        <option value="unit">Sort: unit</option><option value="name">Sort: name</option><option value="status">Sort: status</option></select>
      <button type="button" className={glassButton()} disabled={busy || !detail.whitelist.length} onClick={async () => { if (await ask({ title: "Enable ALL numbers?", body: `Every one of the ${detail.whitelist.length} numbers will open the gates again.`, action: "Enable all" })) void act({ action: "whitelist.enableAll", enabled: true }, "All numbers enabled"); }}>Enable all</button>
      <button type="button" className={glassButton()} disabled={busy || !activeCount} onClick={async () => { if (await ask({ title: "Disable ALL numbers?", body: `No caller will open the gates until numbers are re-enabled (${activeCount} active now). The numbers are kept.`, action: "Disable all" })) void act({ action: "whitelist.enableAll", enabled: false }, "All numbers disabled"); }}>Disable all</button>
      <button type="button" className={glassButton()} disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Import CSV</button>
      <button type="button" className={glassButton()} disabled={!detail.whitelist.length} onClick={() => downloadCsv(`${detail.site.slug}-whitelist-${stampDay()}.csv`, toCsv(["Name", "Mobile", "Unit", "Status", "Last change by"], rows.map((w) => [w.name, localAu(w.phone_e164), w.unit_label ?? "", w.enabled ? "Active" : "Disabled", w.last_authorised_by ?? ""])))}><Download className="size-4" /> Export</button>
      <button type="button" className={glassButton("orange")} disabled={busy} onClick={() => setForm("add")}><Plus className="size-4" /> Add number</button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose a CSV file to import" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </div>}>
      <p className={`m-0 mb-3 text-xs ${MUTED}`}>Applies to every gate at this site. Import takes columns Name, Mobile, Unit (header row optional); numbers already on the list are left as they are.</p>
      {pending && <div className={`${GLASS_TILE} mb-3 p-3 text-sm`} role="status">
        <strong>{pending.rows.length} number{pending.rows.length === 1 ? "" : "s"} ready to import from {pending.file}.</strong>
        {pending.problems.length > 0 && <ul className="m-0 mt-2 max-h-28 list-disc overflow-auto pl-5 text-xs text-[#fbbf24]">{pending.problems.slice(0, 12).map((x) => <li key={x}><span>{x}</span></li>)}{pending.problems.length > 12 && <li><span>…and {pending.problems.length - 12} more lines skipped.</span></li>}</ul>}
        <div className="mt-3 flex gap-2">
          <button type="button" className={glassButton("orange")} disabled={busy} onClick={async () => { const r = await importRows(pending.rows); if (r) setPending(null); }}>Import {pending.rows.length}</button>
          <button type="button" className={glassButton()} onClick={() => setPending(null)}>Cancel</button></div>
      </div>}
      {form && <WhitelistForm key={form} entry={form === "add" ? undefined : detail.whitelist.find((w) => w.id === form)} busy={busy} act={act} onDone={() => setForm(null)} />}
      <div className="max-h-[520px] overflow-auto"><table className="w-full border-collapse">
        <thead><tr><th className={TH}>Unit</th><th className={TH}>Name</th><th className={TH}>Mobile</th><th className={TH}>Status</th><th className={TH}>Last change by</th><th className={TH}>Actions</th></tr></thead>
        <tbody>{rows.length ? rows.map((w) => (
          <tr key={w.id}>
            <Td>{w.unit_label ?? "—"}</Td><Td>{w.name}</Td><Td className="font-mono">{localAu(w.phone_e164)}</Td>
            <Td><Pill tone={w.enabled ? "ok" : "mute"} caps>{w.enabled ? "Active" : "Disabled"}</Pill></Td>
            <Td className={MUTED}>{w.last_authorised_by ?? ""}</Td>
            <td className={TD}><div className="flex items-center gap-1">
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Edit ${w.name}`} disabled={busy} onClick={() => setForm(w.id)}><Pencil className="size-4" /></button>
              <button type="button" className={`${glassButton()} h-8`} disabled={busy} onClick={() => void act({ action: "whitelist.toggle", id: w.id, enabled: !w.enabled }, `${w.name} ${w.enabled ? "disabled" : "enabled"}`)}>{w.enabled ? "Disable" : "Enable"}</button>
              <button type="button" className={`${glassButton()} h-8`} aria-label={`Delete ${w.name}`} disabled={busy}
                onClick={async () => { if (await ask({ title: `Delete ${w.name}?`, body: `${localAu(w.phone_e164)} will no longer open the gates.`, action: "Delete number" })) void act({ action: "whitelist.delete", id: w.id }, `Deleted ${w.name}`); }}><Trash2 className="size-4" /></button>
            </div></td>
          </tr>)) : <tr><Td colSpan={6}><Empty text={detail.whitelist.length ? "No number matches those filters." : "No numbers yet. Add one, or import a CSV."} /></Td></tr>}</tbody>
      </table></div>
    </Section>
  );
}

function WhitelistForm({ entry, busy, act, onDone }: { entry?: Entry; busy: boolean; act: Act; onDone: () => void }) {
  const [name, setName] = useState(entry?.name ?? ""); const [phone, setPhone] = useState(entry ? localAu(entry.phone_e164) : ""); const [unit, setUnit] = useState(entry?.unit_label ?? "");
  return <form className={`${GLASS_TILE} mb-3 grid gap-3 p-3 md:grid-cols-[1.4fr_1fr_1fr_auto]`} aria-label={entry ? `Edit ${entry.name}` : "Add a number"}
    onSubmit={async (e: FormEvent) => {
      e.preventDefault();
      const ok = entry ? await act({ action: "whitelist.update", id: entry.id, name, phone, unitLabel: unit, enabled: entry.enabled }, "Updated") : await act({ action: "whitelist.add", name, phone, unitLabel: unit }, `Added ${name}`);
      if (ok) onDone();
    }}>
    <Field label="Name"><input style={FIELD_STYLE} className={INPUT} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></Field>
    <Field label="Mobile (04xx xxx xxx)"><input style={FIELD_STYLE} className={INPUT} value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} required /></Field>
    <Field label="Unit (e.g. Unit 12)"><input style={FIELD_STYLE} className={INPUT} value={unit} maxLength={40} onChange={(e) => setUnit(e.target.value)} /></Field>
    <div className="flex items-end gap-2"><button type="submit" className={glassButton("orange")} disabled={busy}>{entry ? "Save changes" : "Add"}</button><button type="button" className={glassButton()} onClick={onDone}>Cancel</button></div>
  </form>;
}

// ---------------------------------------------------------------- 7. logs
const ENTITY: Record<string, string> = { gd_whitelist: "Whitelist", gd_schedules: "Auto-open", gd_units: "Gate unit", gd_auth_persons: "Authorised person" };
function changeWhat(c: Change): string {
  const n = c.detail?.new ?? {}, o = c.detail?.old ?? {}, r = Object.keys(n).length ? n : o;
  if (c.entity === "gd_whitelist") return `${r.name ?? ""} ${localAu(r.phone_e164 as string)}${c.action === "update" && n.enabled !== o.enabled ? (n.enabled ? " enabled" : " disabled") : ""}`;
  if (c.entity === "gd_schedules") return `${r.name ?? ""} ${String(r.open_time ?? "").slice(0, 5)}–${String(r.close_time ?? "").slice(0, 5)}`;
  if (c.entity === "gd_units") return `${r.name ?? ""}${n.lockdown !== o.lockdown ? (n.lockdown ? " LOCKDOWN on" : " lockdown off") : ""}${n.enabled !== o.enabled ? (n.enabled ? " enabled" : " disabled") : ""}`;
  return String(r.name ?? "");
}

function CallTable({ calls, units }: { calls: Call[] | null; units: Unit[] }) {
  if (!calls) return <div className="os-row"><LoaderCircle className="animate-spin" /> Loading…</div>;
  const uname = (id: string) => units.find((u) => u.id === id)?.name ?? "?";
  const tone = (r: string) => r === "opened" ? "ok" : ["refused_window", "debounced"].includes(r) ? "mute" : ["no_caller_id", "rate_limited"].includes(r) ? "warn" : "bad";
  return <table className="w-full border-collapse">
    <thead><tr><th className={TH}>Time</th><th className={TH}>Gate</th><th className={TH}>Caller</th><th className={TH}>Mobile</th><th className={TH}>Result</th><th className={TH}>Detail</th></tr></thead>
    <tbody>{calls.length ? calls.map((c) => (
      <tr key={c.id}><Td className="tabular-nums">{fmt(c.occurred_at)}</Td><Td>{uname(c.unit_id)}</Td><Td>{c.caller_name ?? "—"}</Td><Td className="font-mono">{localAu(c.phone_e164)}</Td>
        <Td><Pill tone={tone(c.result) as "ok" | "mute" | "warn" | "bad"} caps>{RESULT_LABELS[c.result] ?? c.result}</Pill></Td><Td className={MUTED}>{c.detail ?? ""}</Td></tr>
    )) : <tr><Td colSpan={6}><Empty text="No calls yet." /></Td></tr>}</tbody>
  </table>;
}

function ChangeTable({ changes }: { changes: Change[] | null }) {
  if (!changes) return <div className="os-row"><LoaderCircle className="animate-spin" /> Loading…</div>;
  return <table className="w-full border-collapse">
    <thead><tr><th className={TH}>Time</th><th className={TH}>What</th><th className={TH}>Action</th><th className={TH}>Detail</th><th className={TH}>Authorised by</th><th className={TH}>Signed in as</th></tr></thead>
    <tbody>{changes.length ? changes.map((c) => <tr key={c.id}><Td className="tabular-nums">{fmt(c.at)}</Td><Td>{ENTITY[c.entity] ?? c.entity}</Td><Td>{c.action}</Td><Td>{changeWhat(c)}</Td><Td>{c.authorised_by ?? ""}</Td><Td className={MUTED}>{c.actor_email ?? ""}</Td></tr>)
      : <tr><Td colSpan={6}><Empty text="No changes yet." /></Td></tr>}</tbody>
  </table>;
}

/**
 * A site this portal can show but not yet control. Says plainly what is and is not available
 * instead of pretending the site is connected.
 */
function LinkedSitePanel({ link }: { link: Extract<OwnerSiteLink, { kind: "external" }> }) {
  return (
    <div>
      <h2 style={{ margin: 0 }}>{link.name}</h2>
      <small style={{ opacity: .7 }}>{link.detail}</small>
      <div className="os-banner info" style={{ marginTop: 14 }}>
        <strong>Not linked to this portal yet.</strong> This gate controller reports only to its own dashboard, so its
        users, schedules and access log cannot be shown or changed from here. Nothing on this page is live data.
      </div>
      <div className="os-card">
        <h3>Its own dashboard</h3>
        <p style={{ fontSize: 13, opacity: .75 }}>{link.note}</p>
        <a className="os-row" href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open {link.name} dashboard in a new tab</a>
      </div>
      <div className="os-card" style={{ marginTop: 14 }}>
        <h3>What linking would add</h3>
        <p style={{ fontSize: 13, opacity: .75 }}>Online status, users, auto-open schedules and the access and changes logs, with the same controls as the other sites.
          It needs a one-off update to the gate controller itself, which will only be made once you have approved the plan.</p>
      </div>
    </div>
  );
}
