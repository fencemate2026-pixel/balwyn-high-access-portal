// Gate open windows: ONE definition used by both the controller-poll engine and
// the calendar, so what the calendar shows is exactly what the engine does.
//
// A "window" is a period during which a gate should be held open. Windows come
// from three sources, all Melbourne local time:
//   schedule   – the weekly Gate schedules page (gate_schedules)
//   booking    – a facility-hire booking linked to a gate (hire_booking_gates)
//   automation – a typed automation rule of kind "gate_window" (automation_rules)
//
// Adding a new kind of automation = add a validator + a window producer below,
// plus a test. Nothing else needs wiring: the engine and the calendar both call
// windowsForDate().
//
// Pure module: no database, no clock except through arguments. Safe to test.
import { DAYS, isGateActive, type DayKey, type WeekPlan } from "./portal-model";

export const TZ = "Australia/Melbourne";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WindowSource = "schedule" | "booking" | "automation";
export type GateWindow = {
  gateId: string;
  source: WindowSource;
  /** Short human label for the calendar and the activity log. */
  label: string;
  /** Stable identity of the rule/booking that produced it (for command de-duplication). */
  ref: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
};

// ---------------------------------------------------------------- time helpers

/** Melbourne local date (YYYY-MM-DD) for an instant. */
export function melbourneDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Melbourne UTC offset in minutes at an instant (+600 or +660). */
function offsetMinutes(at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((part) => [part.type, part.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((local - at.getTime()) / 60000);
}

/**
 * Find the exact UTC instant where Melbourne's offset changes from the one
 * observed at `before` to the one observed at `after` (`before` and `after`
 * must bracket exactly one transition). Millisecond-resolution binary
 * search: the two DST changeovers are the only discontinuities
 * offsetMinutes() has, and both land exactly on the minute in practice, so
 * this always converges to the same instant regardless of which gap time
 * asked for it.
 */
function transitionInstant(before: Date, after: Date): Date {
  const targetOffset = offsetMinutes(after);
  let lo = before.getTime();
  let hi = after.getTime();
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMinutes(new Date(mid)) === targetOffset) hi = mid; else lo = mid;
  }
  return new Date(hi);
}

/**
 * Convert a Melbourne wall-clock date + time to a UTC instant.
 *
 * Melbourne's two DST changeovers each year make this ambiguous on one
 * calendar day, and the naive two-pass offset correction this function used
 * to use can resolve a LATER wall-clock time to an EARLIER UTC instant than
 * an earlier one on that day - inverting a window's start/end (TZ-1/TZ-2,
 * AUDIT_BUGS P3, 18 Oct 2026). Both edge cases are now handled explicitly and
 * deterministically, by sampling the real offset a day either side of the
 * target date (always clear of the transition itself) rather than iterating
 * from a value already perturbed by it:
 *
 *  - SKIPPED hour (DST start, e.g. the 2:00-2:59 that never happens in
 *    October): every nonexistent wall-clock time in the gap collapses to the
 *    single UTC instant of the transition itself (effectively "3:00"), so a
 *    window's start and end that both fall in the gap are always equal, never
 *    inverted, and a window spanning the gap is never shorter than it should
 *    be relative to a real time on the same day.
 *  - REPEATED hour (DST end, e.g. the 2:00-2:59 that happens twice in April):
 *    always resolves to the FIRST (daylight-saving) occurrence, consistently
 *    for every caller - documented here instead of silently picked.
 */
export function melbourneToUtc(dateISO: string, hhmm: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const before = new Date(wall - DAY_MS);
  const after = new Date(wall + DAY_MS);
  const offsetBefore = offsetMinutes(before);
  const offsetAfter = offsetMinutes(after);
  if (offsetBefore === offsetAfter) return new Date(wall - offsetBefore * 60000);
  // A transition falls within this day. Test both candidate offsets: a
  // candidate is valid only if decoding its resulting instant reproduces the
  // SAME offset used to build it (self-consistent).
  const valid = [offsetBefore, offsetAfter].filter((offset) => offsetMinutes(new Date(wall - offset * 60000)) === offset);
  if (valid.length === 1) return new Date(wall - valid[0] * 60000);
  if (valid.length > 1) {
    // Repeated hour: both occurrences are self-consistent. Pick the first
    // (larger/daylight-saving) offset, always.
    return new Date(wall - Math.max(...valid) * 60000);
  }
  // Skipped hour: neither offset is self-consistent, because the wall-clock
  // time never occurred. Collapse to the transition instant itself.
  return transitionInstant(before, after);
}

/** English weekday name for a Melbourne local date. */
export function weekdayOf(dateISO: string): DayKey {
  const [y, m, d] = dateISO.split("-").map(Number);
  const index = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = Sunday
  return DAYS[(index + 6) % 7];
}

export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

// ------------------------------------------------------- automation rule types

export type GateWindowRuleConfig = {
  gateId: string;
  open: string;
  close: string;
  /** Either repeat on these weekdays … */
  days?: DayKey[];
  /** … or run once on this Melbourne date. Exactly one of the two. */
  date?: string;
};

export type RuleKind = "note" | "gate_window";
export const RULE_KINDS: Record<RuleKind, { label: string; executes: boolean }> = {
  note: { label: "Note only (not automated)", executes: false },
  gate_window: { label: "Hold a gate open for a time window", executes: true },
};

/** Validate and normalise a gate_window config. Throws a plain-English error. */
export function parseGateWindowConfig(input: unknown): GateWindowRuleConfig {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const gateId = String(value.gateId ?? "");
  const open = String(value.open ?? "");
  const close = String(value.close ?? "");
  if (!isGateActive(gateId)) throw new Error("Choose an active gate.");
  if (!HHMM.test(open) || !HHMM.test(close)) throw new Error("Enter opening and closing times as HH:MM.");
  if (open >= close) throw new Error("The opening time must be before the closing time.");
  const hasDate = value.date !== undefined && value.date !== null && value.date !== "";
  const days = Array.isArray(value.days) ? [...new Set(value.days.map(String))] : [];
  if (hasDate === days.length > 0) throw new Error("Choose either repeating weekdays or a single date.");
  if (hasDate) {
    const date = String(value.date);
    if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error("Choose a valid date.");
    return { gateId, open, close, date };
  }
  if (!days.every((day): day is DayKey => (DAYS as string[]).includes(day))) throw new Error("Choose valid weekdays.");
  return { gateId, open, close, days: DAYS.filter((day) => days.includes(day)) };
}

export type StoredRule = { id: number; name: string; kind: string; config: string | null; enabled: boolean };
export type BookingLink = { bookingId: string; gateId: string; label: string; startsAt: string; endsAt: string; leadMinutes: number; lagMinutes: number };

// ------------------------------------------------------------- window producer

/**
 * Every open window, for every active gate, that touches the Melbourne date.
 * Bookings are passed in already filtered to the relevant period.
 * Malformed stored rules are skipped (and never executed), never guessed at.
 */
export function windowsForDate(
  dateISO: string,
  schedules: Record<string, WeekPlan>,
  rules: StoredRule[],
  bookings: BookingLink[],
): GateWindow[] {
  const day = weekdayOf(dateISO);
  const windows: GateWindow[] = [];

  for (const [gateId, week] of Object.entries(schedules)) {
    const plan = week?.[day];
    if (!isGateActive(gateId) || !plan?.enabled || !HHMM.test(plan.open) || !HHMM.test(plan.close) || plan.open >= plan.close) continue;
    windows.push({
      gateId, source: "schedule", label: `Weekly schedule ${plan.open}–${plan.close}`, ref: `schedule:${gateId}:${day}:${plan.open}-${plan.close}`,
      start: melbourneToUtc(dateISO, plan.open).toISOString(), end: melbourneToUtc(dateISO, plan.close).toISOString(),
    });
  }

  for (const rule of rules) {
    if (!rule.enabled || rule.kind !== "gate_window" || !rule.config) continue;
    let config: GateWindowRuleConfig;
    try { config = parseGateWindowConfig(JSON.parse(rule.config)); } catch { continue; }
    if (config.date ? config.date !== dateISO : !config.days?.includes(day)) continue;
    windows.push({
      gateId: config.gateId, source: "automation", label: `${rule.name} ${config.open}–${config.close}`, ref: `rule:${rule.id}:${config.open}-${config.close}`,
      start: melbourneToUtc(dateISO, config.open).toISOString(), end: melbourneToUtc(dateISO, config.close).toISOString(),
    });
  }

  const dayStart = melbourneToUtc(dateISO, "00:00").getTime();
  const dayEnd = melbourneToUtc(addDays(dateISO, 1), "00:00").getTime();
  for (const booking of bookings) {
    if (!isGateActive(booking.gateId)) continue;
    const start = Date.parse(booking.startsAt) - booking.leadMinutes * 60000;
    const end = Date.parse(booking.endsAt) + booking.lagMinutes * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= dayStart || start >= dayEnd) continue;
    windows.push({
      gateId: booking.gateId, source: "booking", label: booking.label, ref: `booking:${booking.bookingId}:${booking.leadMinutes}:${booking.lagMinutes}`,
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    });
  }

  return windows.sort((a, b) => a.start.localeCompare(b.start) || a.gateId.localeCompare(b.gateId));
}

// ------------------------------------------------------------ engine decision

export type Directive = { target: "open" | "closed"; key: string; reason: string };

/**
 * What should this gate be doing now?
 *  - inside any window                     → open (hold)
 *  - outside, but a window exists today    → closed (release the hold / auto-close)
 *  - no window today                       → null: automation leaves the gate alone
 * The key identifies the specific window/gap, so each open and each release is
 * queued once, and a changed rule produces a fresh command.
 */
export function resolveDirective(gateId: string, windows: GateWindow[], now: Date): Directive | null {
  const mine = windows.filter((window) => window.gateId === gateId);
  if (!mine.length) return null;
  const t = now.getTime();
  const active = mine.filter((window) => Date.parse(window.start) <= t && t < Date.parse(window.end));
  const signature = hash(mine.map((window) => `${window.ref}@${window.start}/${window.end}`).join("|"));
  if (active.length) {
    // Merge overlapping windows into one hold, keyed by the earliest start.
    const first = active.reduce((a, b) => (a.start <= b.start ? a : b));
    return { target: "open", key: `win-${gateId}-${first.start}-open-${signature}`, reason: active.map((window) => window.label).join(" + ") };
  }
  const ended = mine.filter((window) => Date.parse(window.end) <= t).sort((a, b) => b.end.localeCompare(a.end))[0];
  const since = ended ? ended.end : `${melbourneDate(now)}T-start`;
  return { target: "closed", key: `win-${gateId}-${since}-closed-${signature}`, reason: ended ? `After ${ended.label}` : "Before today's first window" };
}

/** Short stable FNV-1a hash for keys (not security-relevant). */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}
