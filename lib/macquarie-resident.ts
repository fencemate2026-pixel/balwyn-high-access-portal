/**
 * Macquarie Drive Thomastown resident portal — decisions with no database or network.
 * The resident page may change only a sliding gate. It never selects the swing unit.
 */
import { OwnerSiteInputError, UNIT_ONLINE_SECONDS, scheduleInput } from "./owner-sites-model.ts";

export const MACQUARIE_SITE_SLUGS = ["macquarie-drive", "thomastown"] as const;
export const MACQUARIE_SEED_EMAIL = "info@rjlcommercialgroup.com";
export const MACQUARIE_SEED_NAME = "Jarrod Alebakis";
export const MACQUARIE_SITE_LABEL = "Macquarie Drive Thomastown";
export const MACQUARIE_ONLINE_SECONDS = UNIT_ONLINE_SECONDS;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TZ = "Australia/Melbourne";

export type SlidingCandidate = { id: string; name?: unknown; gate_type?: unknown; device_id?: unknown };

const CLICKS: Record<string, string> = {
  "week-prev": "Moved to the previous week on the hold-open board",
  "week-next": "Moved to the next week on the hold-open board",
  "day-select": "Selected a day on the hold-open board",
  "hold-form": "Opened the hold-open form",
  "users-form": "Opened the user form",
  "info-fire": "Opened the fire evacuation information",
  "info-ai": "Opened the AI information",
  weather: "Refreshed Thomastown weather",
  "gate-card": "Selected the sliding gate card",
  "sign-out": "Signed out",
};

export function residentEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

export function isSeedEmail(email: string): boolean {
  return email === MACQUARIE_SEED_EMAIL;
}

export function emailMaySignIn(email: string, rows: { email: string }[]): boolean {
  if (isSeedEmail(email)) return true;
  return rows.some((row) => row.email.trim().toLowerCase() === email);
}

export function portalUserName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f]/.test(name)) return null;
  return name;
}

/** Exactly one sliding unit. A swing, double, or a second slider is not a guess. */
export function isSlidingUnit(unit: SlidingCandidate): boolean {
  const text = `${unit.gate_type ?? ""} ${unit.name ?? ""} ${unit.device_id ?? ""}`;
  return /slid/i.test(text) && !/swing|double/i.test(text);
}

export function pickSlidingUnit<T extends SlidingCandidate>(units: T[]): T | null {
  const matches = units.filter(isSlidingUnit);
  return matches.length === 1 ? matches[0] : null;
}

/** Caller numbers are stored once per site. Refuse when another gate would inherit the change. */
export function callersWritable(units: { id: string }[], slidingId: string): boolean {
  return units.length > 0 && units.every((unit) => unit.id === slidingId);
}

export function unitOnline(lastSeen: unknown, nowMs: number, windowSeconds = MACQUARIE_ONLINE_SECONDS): boolean {
  if (typeof lastSeen !== "string") return false;
  const seen = Date.parse(lastSeen);
  if (!Number.isFinite(seen)) return false;
  const age = nowMs - seen;
  return age >= -120_000 && age < windowSeconds * 1000;
}

export function activityLine(sentence: string): string {
  const clean = sentence.replace(/[\u0000-\u001f]/g, " ").replace(/\b\d{6}\b/g, "[code]").replace(/\s+/g, " ").trim();
  const text = clean.startsWith(MACQUARIE_SITE_LABEL) ? clean : `${MACQUARIE_SITE_LABEL}: ${clean}`;
  return text.slice(0, 1000);
}

export function clickDetail(target: unknown, label: unknown): string | null {
  if (typeof target !== "string" || !Object.prototype.hasOwnProperty.call(CLICKS, target)) return null;
  const extra = typeof label === "string" ? label.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) : "";
  return activityLine(extra ? `${CLICKS[target]} (${extra})` : CLICKS[target]);
}

export function loginCodeMaterial(secret: string, email: string, code: string): string {
  return `${secret}\n${email.trim().toLowerCase()}\n${code}`;
}

export function withinRate(previous: number[], now: number, windowMs: number, limit: number): { ok: boolean; next: number[] } {
  const kept = previous.filter((time) => now - time < windowMs && now - time >= 0);
  if (kept.length >= limit) return { ok: false, next: kept };
  return { ok: true, next: [...kept, now] };
}

export function melbourneParts(value: Date): { date: string; clock: string; weekday: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const clockParts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const hour = clockParts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = clockParts.find((part) => part.type === "minute")?.value ?? "00";
  const weekdayName = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "long" }).format(value);
  return { date, clock: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`, weekday: WEEKDAYS.indexOf(weekdayName) + 1 };
}

export type HoldRow = { name: string; open_time: string; close_time: string; days: number[]; span_days: number; enabled: boolean };

export function holdNowWindow(now: Date, untilRaw: unknown): { ok: true; row: HoldRow } | { ok: false; error: string } {
  const { clock, weekday } = melbourneParts(now);
  if (weekday < 1) return { ok: false, error: "The date could not be read." };
  const requested = typeof untilRaw === "string" && HHMM.test(untilRaw) ? untilRaw : "";
  const close = requested || (clock < "18:00" ? "18:00" : "23:59");
  if (close <= clock) return { ok: false, error: "Choose a later time today." };
  return { ok: true, row: { name: "Hold open", open_time: clock, close_time: close, days: [weekday], span_days: 0, enabled: true } };
}

export function plannedHold(body: Record<string, unknown>): { ok: true; row: HoldRow } | { ok: false; error: string } {
  try {
    const row = scheduleInput({ ...body, spanDays: 0, enabled: true });
    return { ok: true, row };
  } catch (error) {
    return { ok: false, error: error instanceof OwnerSiteInputError ? error.message : "That window is not valid." };
  }
}

export function windowCoversNow(now: Date, row: { days: number[]; open_time: string; close_time: string; span_days: number; enabled: boolean }): boolean {
  if (!row.enabled || row.span_days !== 0) return false;
  const { clock, weekday } = melbourneParts(now);
  return row.days.includes(weekday) && row.open_time <= clock && clock < row.close_time;
}
