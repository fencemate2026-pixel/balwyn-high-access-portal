/**
 * Thomastown swing gate — pure validation for (a) owner commands going to the Pi and
 * (b) data the Pi pushes to the portal. No I/O.
 *
 * Command rules mirror portal_sync/portal_commands.py on the Pi, which re-validates everything
 * and is the final authority (the Pi's own database decides). Numbers are Australian only here,
 * stored in local form (04xx xxx xxx without spaces); the Pi compares in its own canonical form.
 */
import { OwnerSiteInputError, normaliseAu } from "@/lib/owner-sites-model";

export const SWING_DEVICE_ID = "thomastown-swing";
export const SWING_SITE_NAME = "Thomastown Body Corp · double swing gate";
export const SLIDING_DEVICE_ID = "thomastown-sliding";
export const SLIDING_SITE_NAME = "Thomastown Body Corp · sliding gate";
/**
 * The Azure-backed gate sites. Each has its own device id, its own HMAC secret (App Service setting
 * NAMED here, never the value) and its own device and owner routes. The Pi software and the command
 * rules are identical, so one handler serves them all.
 */
export const GD_SITES = {
  [SWING_DEVICE_ID]: { name: SWING_SITE_NAME, secretEnv: "GD_THOMASTOWN_SWING_SECRET" },
  [SLIDING_DEVICE_ID]: { name: SLIDING_SITE_NAME, secretEnv: "GD_THOMASTOWN_SLIDING_SECRET" },
} as const;
export type GdSiteId = keyof typeof GD_SITES;
/** The number callers ring to open each gate (the gate SIM's own number). Shown to the owner only. Display-only: never used for access. */
const GD_DIAL_IN: Partial<Record<GdSiteId, string>> = {
  [SWING_DEVICE_ID]: "0475184833",   // Telstra SIM in the swing gate Pi (Jarrod, 6 Nov 2026). The sliding gate's number has not been given.
};
export const gdDialIn = (site: GdSiteId): string | null => GD_DIAL_IN[site] ?? null;
export const isGdSiteId = (v: unknown): v is GdSiteId => typeof v === "string" && Object.prototype.hasOwnProperty.call(GD_SITES, v);
export const SWING_KINDS = ["user.add", "user.update", "user.delete", "user.enable"] as const;
export type SwingKind = typeof SWING_KINDS[number];
/** A command the Pi has not collected within this time is dropped, never applied late. */
export const COMMAND_TTL_MINUTES = 15;
export const PUSH_MAX_BYTES = 262_144;
export const PUSH_MAX_ROWS = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const bad = (m: string): never => { throw new OwnerSiteInputError(m); };

function name(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 60 || /[\u0000-\u001f\u007f]/.test(s)) bad("Name must be 1-60 characters.");
  return s;
}
const localId = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? v as number : bad("Unknown entry."));
const flag = (v: unknown) => (typeof v === "boolean" ? v : bad("Enabled must be on or off."));
/** 04xxxxxxxx / 03xxxxxxxx digits, from any Australian format the owner types or pastes. */
export function phoneLocal(v: unknown): string {
  const e = normaliseAu(v);
  return e ? `0${e.slice(3)}` : bad("Enter a valid Australian phone number.");
}
export function displayPhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  if (/^04\d{8}$/.test(d)) return d.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
  if (/^0[23578]\d{8}$/.test(d)) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2 $3");
  return String(p ?? "") || "—";
}
function schedule(body: Record<string, unknown>) {
  const t = body.schedule_type ?? "always";
  if (t === "always") return { schedule_type: "always", schedule_data: null };
  if (t !== "time_range") bad("Schedule must be Always or Set hours.");
  const d = Array.isArray(body.schedule_days) ? body.schedule_days : [];
  if (!d.length || d.length > 7 || d.some((x) => !Number.isInteger(x) || x < 0 || x > 6) || new Set(d).size !== d.length) bad("Pick at least one day.");
  const start = body.schedule_start, end = body.schedule_end;
  if (typeof start !== "string" || !TIME.test(start) || typeof end !== "string" || !TIME.test(end)) bad("Times must be HH:MM (24 hour).");
  if (start === end) bad("Start and end cannot be the same.");
  // The Pi's format exactly: {"days":[0-6, Monday=0],"start":"HH:MM","end":"HH:MM"}
  return { schedule_type: "time_range", schedule_data: JSON.stringify({ days: [...d as number[]].sort((a, b) => a - b), start, end }) };
}

export type SwingCommandInput = { kind: SwingKind; args: Record<string, unknown>; clientKey: string; summary: string };

/** Validate an owner's browser request into a queueable command. */
export function swingCommandInput(body: Record<string, unknown>): SwingCommandInput {
  const kind = body.kind;
  if (!(SWING_KINDS as readonly unknown[]).includes(kind)) bad("Unknown action.");
  const clientKey = typeof body.clientKey === "string" && UUID.test(body.clientKey) ? body.clientKey : bad("Reload the page and try again.");
  const k = kind as SwingKind;
  let args: Record<string, unknown> = {}, summary = "";
  switch (k) {
    case "user.add": {
      const n = name(body.name);
      args = { name: n, phone: phoneLocal(body.phone), ...schedule(body) };
      summary = `Add caller ${n} (${displayPhone(String(args.phone))})`; break;
    }
    case "user.update": {
      args = { local_id: localId(body.local_id) };
      if (body.name !== undefined) args.name = name(body.name);
      if (body.phone !== undefined && body.phone !== "") args.phone = phoneLocal(body.phone);
      if (body.schedule_type !== undefined) Object.assign(args, schedule(body));
      if (Object.keys(args).length === 1) bad("Nothing to change.");
      summary = `Edit caller #${args.local_id}${args.name ? ` (${args.name})` : ""}`; break;
    }
    case "user.delete": args = { local_id: localId(body.local_id) }; summary = `Delete caller #${args.local_id}`; break;
    case "user.enable": args = { local_id: localId(body.local_id), enabled: flag(body.enabled) }; summary = `${args.enabled ? "Enable" : "Disable"} caller #${args.local_id}`; break;
  }
  return { kind: k, args, clientKey, summary };
}

/** Human result for a gate-app access_log method + outcome. */
export function callResult(method: string | null, success: boolean | null): { label: string; tone: "ok" | "bad" | "warn" | "mute" } {
  const m = String(method ?? "");
  if (success) return { label: "Opened", tone: "ok" };
  if (m.endsWith("-denied")) return { label: "Refused – not allowed", tone: "bad" };
  if (m.endsWith("-lockdown")) return { label: "Refused – lockdown", tone: "warn" };
  if (m.endsWith("-hardware-failed")) return { label: "RELAY FAULT", tone: "bad" };
  if (m.endsWith("-busy-or-unavailable")) return { label: "Gate busy", tone: "warn" };
  return { label: success === false ? "Not opened" : "—", tone: "mute" };
}

// ---- Data pushed by the Pi: bounded, typed, scrubbed. Anything unexpected is dropped, never stored. ----
const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v: unknown): number | null => (Number.isSafeInteger(v) ? v as number : null);
const ts = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?/.test(v) ? v.slice(0, 19) : null);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.slice(0, PUSH_MAX_ROWS).filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r)) : []);

export type PushUser = { local_id: number; name: string; phone: string; enabled: boolean; schedule_type: string | null; schedule_data: string | null; created_at_local: string | null };
export type PushAccess = { local_id: number; occurred_at_local: string | null; user_name: string | null; method: string | null; success: boolean | null };
export type PushChange = { local_id: number; occurred_at_local: string | null; action: string | null; detail: string | null; changed_by: string | null };
export type PushBody = { fw_version: string | null; status: Record<string, unknown> | null; users: PushUser[] | null; access: PushAccess[]; changes: PushChange[] };

export function pushInput(b: Record<string, unknown>): PushBody {
  const users = b.users === undefined || b.users === null ? null : rows(b.users).flatMap((r) => {
    const local_id = int(r.local_id), nm = str(r.name, 80), phone = str(r.phone, 24);
    return local_id && local_id > 0 && nm && phone ? [{ local_id, name: nm, phone, enabled: r.enabled === true || r.enabled === 1,
      schedule_type: str(r.schedule_type, 20), schedule_data: str(r.schedule_data, 300), created_at_local: ts(r.created_at_local) }] : [];
  });
  const status = b.status && typeof b.status === "object" && !Array.isArray(b.status) ? sanitiseStatus(b.status as Record<string, unknown>) : null;
  return {
    fw_version: str(b.fw_version, 40), status, users,
    access: rows(b.access).flatMap((r) => { const id = int(r.local_id); return id && id > 0 ? [{ local_id: id, occurred_at_local: ts(r.occurred_at_local), user_name: str(r.user_name, 80), method: str(r.method, 40), success: r.success === null || r.success === undefined ? null : (r.success === true || r.success === 1) }] : []; }),
    changes: rows(b.changes).flatMap((r) => { const id = int(r.local_id); return id && id > 0 ? [{ local_id: id, occurred_at_local: ts(r.occurred_at_local), action: str(r.action, 60), detail: str(r.detail, 300), changed_by: str(r.changed_by, 80) }] : []; }),
  };
}

/** Heartbeat values only: numbers, booleans and short strings, one level deep. */
function sanitiseStatus(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s).slice(0, 40)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 80);
  }
  return out;
}
