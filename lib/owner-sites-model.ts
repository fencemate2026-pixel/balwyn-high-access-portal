/**
 * Owner sites (GSM gate diallers) — pure validation and shaping. No I/O.
 *
 * 30 Oct 2026 (Jarrod): the Magic Keys owner sees every RJL site in one place
 * (Thomastown first: sliding + double swing gate diallers). Data lives in the
 * gd_* tables of the same Supabase project. Rules here mirror the Pi software
 * (thomgate v6 decide.normalise_au / schedule.validate) so the portal can never
 * store something the gate would read differently.
 */

export type OwnerSiteAction =
  | "whitelist.add" | "whitelist.update" | "whitelist.delete"
  | "schedule.save" | "schedule.delete"
  | "unit.update" | "person.add" | "person.delete" | "site.ackShrink";

export const RESULT_LABELS: Record<string, string> = {
  opened: "Opened",
  refused_not_whitelisted: "Refused – not on list",
  refused_disabled: "Refused – number disabled",
  refused_window: "Refused – auto-open window",
  refused_lockout: "Refused – lockdown",
  refused_unit_disabled: "Refused – unit disabled",
  debounced: "Repeat call ignored",
  rate_limited: "Too soon after last open",
  no_caller_id: "No caller ID",
  relay_error: "RELAY FAULT",
};

/** A unit counts as online if it reached the cloud within this many seconds (it long-polls every ~25 s). */
export const UNIT_ONLINE_SECONDS = 90;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class OwnerSiteInputError extends Error {}

export function isUuid(v: unknown): v is string { return typeof v === "string" && UUID.test(v); }
export function isSlug(v: unknown): v is string { return typeof v === "string" && SLUG.test(v); }

/** +61XXXXXXXXX for an Australian number, else null. Same rules as the Pi. */
export function normaliseAu(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  let e: string | null = null;
  if (d.startsWith("61") && d.length === 11) e = `+${d}`;
  else if (d.startsWith("0") && d.length === 10) e = `+61${d.slice(1)}`;
  else if (d.length === 9 && "23478".includes(d[0])) e = `+61${d}`;
  return e && /^\+61[2-9]\d{8}$/.test(e) ? e : null;
}

export function localAu(e164: string | null | undefined): string {
  if (!e164 || !e164.startsWith("+61")) return "—";
  return `0${e164.slice(3)}`.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
}

function text(v: unknown, max: number, field: string, required = true): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) { if (required) throw new OwnerSiteInputError(`${field} is required.`); return null; }
  if (s.length > max) throw new OwnerSiteInputError(`${field} is too long.`);
  return s;
}

export function whitelistInput(body: Record<string, unknown>) {
  const name = text(body.name, 80, "Name")!;
  const phone = normaliseAu(body.phone);
  if (!phone) throw new OwnerSiteInputError("Enter a valid Australian phone number.");
  const unitLabel = text(body.unitLabel, 40, "Unit", false);
  const out: { name: string; phone_e164: string; unit_label: string | null; enabled?: boolean } =
    { name, phone_e164: phone, unit_label: unitLabel };
  if (typeof body.enabled === "boolean") out.enabled = body.enabled;
  return out;
}

export function scheduleInput(body: Record<string, unknown>) {
  const name = text(body.name, 60, "Window name")!;
  const open = String(body.openTime ?? ""), close = String(body.closeTime ?? "");
  if (!HHMM.test(open) || !HHMM.test(close)) throw new OwnerSiteInputError("Times must be HH:MM.");
  const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number))].sort() : [];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new OwnerSiteInputError("Pick at least one day.");
  const span = Number(body.spanDays ?? 0);
  if (!Number.isInteger(span) || span < 0 || span > 6) throw new OwnerSiteInputError("Extra days must be 0 to 6.");
  if (span === 0 && open === close) throw new OwnerSiteInputError("Open and close time are the same.");
  return { name, open_time: open, close_time: close, days, span_days: span, enabled: body.enabled !== false };
}

export function unitInput(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (typeof body.lockdown === "boolean") out.lockdown = body.lockdown;
  if (typeof body.enabled === "boolean") out.enabled = body.enabled;
  if (body.pulseSeconds !== undefined) {
    const p = Number(body.pulseSeconds);
    if (!(p >= 0.2 && p <= 3)) throw new OwnerSiteInputError("Pulse must be 0.2 to 3 seconds.");
    out.pulse_seconds = Math.round(p * 100) / 100;
  }
  if (body.simNumber !== undefined) {
    const raw = String(body.simNumber ?? "").trim();
    if (raw && !normaliseAu(raw)) throw new OwnerSiteInputError("SIM number is not a valid Australian number.");
    out.sim_number = raw ? `0${normaliseAu(raw)!.slice(3)}` : null;
  }
  if (body.deviceKeyFingerprint !== undefined) {
    const fp = String(body.deviceKeyFingerprint ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(fp)) throw new OwnerSiteInputError("The device key fingerprint must be 64 letters/digits from install.sh.");
    out.secret_hash = fp;
  }
  if (!Object.keys(out).length) throw new OwnerSiteInputError("Nothing to change.");
  return out;
}

export function personInput(body: Record<string, unknown>) {
  return { name: text(body.name, 80, "Name")!, role: text(body.role, 60, "Role", false), phone: text(body.phone, 30, "Phone", false) };
}

export function authorisedBy(body: Record<string, unknown>, ownerName: string): string {
  return text(body.authorisedBy, 80, "Authorised by", false) ?? ownerName;
}

/**
 * Health dot for a site in the owner's list. "" = no gate units to report on (not monitored),
 * "bad" = any unit silent for UNIT_ONLINE_SECONDS or more, "warn" = a unit still applying an
 * older config or in lockdown, "ok" = every unit reporting and up to date.
 */
export function siteHealth(
  site: { config_version: number; gd_units: { last_seen: string | null; applied_version: number; lockdown: boolean }[] },
  now: number,
): "" | "ok" | "warn" | "bad" {
  if (!site.gd_units.length) return "";
  if (site.gd_units.some((u) => !u.last_seen || (now - Date.parse(u.last_seen)) / 1000 >= UNIT_ONLINE_SECONDS)) return "bad";
  return site.gd_units.some((u) => u.applied_version < site.config_version || u.lockdown) ? "warn" : "ok";
}
