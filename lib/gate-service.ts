/**
 * Gate operation counter and service tracking.
 *
 * Rule (RJL, 10 Oct 2026): a gate is due for service every SERVICE_INTERVAL_MONTHS
 * (6 months: two services a year) OR after SERVICE_OPERATION_LIMIT operations
 * (4,000) since its last service, whichever comes first. RJL is emailed when a
 * gate reaches the operation limit BEFORE its scheduled service date, with an
 * early warning at 90 % of the limit.
 *
 * What counts as an operation (24 Oct 2026): for a gate with a commissioned
 * controller, every time its closed-position reed reports the gate leaving
 * closed (portal-store countReedCycle). That includes keypad, Compass reader,
 * exit-button and schedule openings, not only portal commands. For a gate
 * without a controller, a remote-open pulse acknowledged by the door service.
 * A cycle that starts and finishes while the controller is offline is missed.
 *
 * Counting must never block or slow a gate command: recordGateOperation never
 * throws, and a missing table (migration not applied yet) just disables counting.
 */
import { getSql } from "@/db";
import { env } from "@/lib/server-env";
import { GATES, isGateActive, type GateServiceInfo, type PortalUser } from "@/lib/portal-model";
import { sendRjlAlert } from "@/lib/rjl-alerts";

export const SERVICE_OPERATION_LIMIT_DEFAULT = 4000;
export const SERVICE_INTERVAL_MONTHS_DEFAULT = 6;
export const SERVICE_WARNING_RATIO = 0.9;

type CounterRow = {
  gate_id: string;
  total_operations: number;
  operations_since_service: number;
  last_service_at: string | null;
  alert_level: number;
};

type Runtime = Record<string, string | undefined>;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Service rule from server settings, with safe defaults and bounds. */
export function serviceRule(runtime: Runtime = env as unknown as Runtime) {
  return {
    operationLimit: boundedInteger(runtime.GATE_SERVICE_OPERATION_LIMIT, SERVICE_OPERATION_LIMIT_DEFAULT, 100, 1_000_000),
    intervalMonths: boundedInteger(runtime.GATE_SERVICE_INTERVAL_MONTHS, SERVICE_INTERVAL_MONTHS_DEFAULT, 1, 24),
  };
}

/** Adds calendar months, clamping to the last day of the target month (31 Aug + 6 = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const start = new Date(iso);
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1, start.getUTCHours(), start.getUTCMinutes()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return target.toISOString();
}

/** Alert level the count has reached: 0 none, 1 early warning (90 %), 2 service due (limit). */
export function alertLevelFor(operationsSinceService: number, operationLimit: number): 0 | 1 | 2 {
  if (operationsSinceService >= operationLimit) return 2;
  if (operationsSinceService >= Math.ceil(operationLimit * SERVICE_WARNING_RATIO)) return 1;
  return 0;
}

/** Pure status used by the dashboard and by the alert decision. */
export function gateServiceStatus(
  row: Pick<CounterRow, "total_operations" | "operations_since_service" | "last_service_at"> | null,
  now: Date,
  rule = serviceRule(),
): GateServiceInfo {
  const since = Math.max(0, Number(row?.operations_since_service ?? 0));
  const total = Math.max(0, Number(row?.total_operations ?? 0));
  const lastServiceAt = row?.last_service_at ? new Date(row.last_service_at).toISOString() : null;
  const nextServiceAt = lastServiceAt ? addMonths(lastServiceAt, rule.intervalMonths) : null;
  const dateDue = nextServiceAt !== null && Date.parse(nextServiceAt) <= now.getTime();
  const level = alertLevelFor(since, rule.operationLimit);
  const state: GateServiceInfo["state"] = dateDue || level === 2 ? "due" : level === 1 ? "soon" : "ok";
  return {
    operationsSinceService: since,
    totalOperations: total,
    operationLimit: rule.operationLimit,
    intervalMonths: rule.intervalMonths,
    lastServiceAt,
    nextServiceAt,
    state,
    dueReason: level === 2 && !dateDue ? "operations" : dateDue ? "date" : null,
  };
}

/** Reads every gate's counter for the dashboard. Returns null if counting is not set up yet. */
export async function readGateService(now = new Date()): Promise<Record<string, GateServiceInfo> | null> {
  try {
    const rows = await getSql().prepare(
      "SELECT gate_id, total_operations, operations_since_service, last_service_at, alert_level FROM gate_service_counters",
    ).all<CounterRow>();
    const rule = serviceRule();
    return Object.fromEntries(GATES.filter((gate) => gate.active).map((gate) => {
      const row = rows.results.find((candidate) => candidate.gate_id === gate.id) ?? null;
      return [gate.id, gateServiceStatus(row, now, rule)];
    }));
  } catch {
    return null;
  }
}

const dateText = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" }).format(new Date(iso))
  : "not recorded";

function serviceAlertText(gateName: string, gateId: string, status: GateServiceInfo, level: 1 | 2) {
  const limit = status.operationLimit.toLocaleString("en-AU");
  const count = status.operationsSinceService.toLocaleString("en-AU");
  const subject = level === 2
    ? `Magic Keys: ${gateName} is due for service (${limit} operations reached)`
    : `Magic Keys: ${gateName} is approaching service (${count} of ${limit} operations)`;
  const body = [
    level === 2
      ? `${gateName} (${gateId}) has reached ${count} operations since its last service. The service limit is ${limit} operations, so it is due for service now, ahead of its scheduled date.`
      : `${gateName} (${gateId}) has reached ${count} of ${limit} operations since its last service (90 % of the limit). Plan a service visit before the scheduled date.`,
    "",
    `Operations since last service: ${count}`,
    `Total operations recorded: ${status.totalOperations.toLocaleString("en-AU")}`,
    `Last service: ${dateText(status.lastServiceAt)}`,
    `Scheduled next service: ${status.nextServiceAt ? dateText(status.nextServiceAt) : "not set (record the last service in the portal)"}`,
    "",
    "Counted: every time the gate controller saw the gate leave its closed-position sensor (portal, keypad / Compass reader, exit button and schedules). Openings made while the controller was offline are not included, so actual use may be slightly higher.",
    "",
    "After servicing, record it in the portal (Campus overview > Gate service > Record service) to reset the count.",
  ].join("\n");
  return { subject, body };
}

/**
 * Adds one confirmed operation for a gate and, if the gate has just reached the
 * early-warning or service-due count before its scheduled service date, emails
 * RJL once for that service period. Never throws.
 */
export async function recordGateOperation(gateId: string, options: { now?: Date; fetcher?: typeof fetch; runtime?: Runtime; waitForAlert?: boolean; unlessReedCounted?: boolean } = {}) {
  if (!isGateActive(gateId)) return null;
  const now = options.now ?? new Date();
  try {
    const d1 = getSql();
    if (options.unlessReedCounted) {
      // A gate with a commissioned controller is counted from its reeds
      // (countReedCycle in portal-store), so a door-service pulse is not counted again.
      const row = await d1.prepare("SELECT commissioned FROM gate_states WHERE gate_id = ?").bind(gateId).first<{ commissioned: number | boolean }>();
      if (row && (row.commissioned === true || Number(row.commissioned) === 1)) return null;
    }
    const stamp = now.toISOString();
    const [, read] = await d1.batch<CounterRow>([
      d1.prepare(
        `INSERT INTO gate_service_counters (gate_id, total_operations, operations_since_service, updated_at)
         VALUES (?, 1, 1, ?::timestamptz)
         ON CONFLICT (gate_id) DO UPDATE SET
           total_operations = gate_service_counters.total_operations + 1,
           operations_since_service = gate_service_counters.operations_since_service + 1,
           updated_at = excluded.updated_at`,
      ).bind(gateId, stamp),
      d1.prepare("SELECT gate_id, total_operations, operations_since_service, last_service_at, alert_level FROM gate_service_counters WHERE gate_id = ?").bind(gateId),
    ]);
    const row = read?.results?.[0];
    if (!row) return null;
    const rule = serviceRule(options.runtime);
    const status = gateServiceStatus(row, now, rule);
    const reached = alertLevelFor(status.operationsSinceService, rule.operationLimit);
    // Only alert when the count gets there BEFORE the scheduled date (or no date is set yet).
    const beforeSchedule = !status.nextServiceAt || Date.parse(status.nextServiceAt) > now.getTime();
    if (reached > Number(row.alert_level) && beforeSchedule) {
      // Claim the alert level first so concurrent operations send one email, not two.
      // The claim also re-checks the count and the service period it read, so a
      // service recorded in between can never inherit this period's alert level.
      const threshold = reached === 2 ? rule.operationLimit : Math.ceil(rule.operationLimit * SERVICE_WARNING_RATIO);
      const claim = await d1.prepare(
        "UPDATE gate_service_counters SET alert_level = ? WHERE gate_id = ? AND alert_level < ? AND operations_since_service >= ? AND last_service_at IS NOT DISTINCT FROM ?::timestamptz",
      ).bind(reached, gateId, reached, threshold, row.last_service_at ? new Date(row.last_service_at).toISOString() : null).run();
      if (Number(claim.meta?.changes ?? 0) === 1) {
        const gate = GATES.find((candidate) => candidate.id === gateId);
        const { subject, body } = serviceAlertText(gate?.name ?? gateId, gateId, status, reached as 1 | 2);
        const sending = sendRjlAlert({
          kind: reached === 2 ? "service_due" : "service_warning",
          subject, body,
          idempotencyKey: `service-${gateId}-${status.lastServiceAt ?? "unset"}-${reached}`,
        }, { fetcher: options.fetcher, runtime: options.runtime });
        // Not awaited by default: an email (up to 8 s) must never delay a gate
        // command's response. sendRjlAlert never throws.
        if (options.waitForAlert) await sending; else void sending;
      }
    }
    return status;
  } catch {
    console.warn("gate_service_counter_failed", JSON.stringify({ gateId }));
    return null;
  }
}

/** Earliest and latest accepted service dates (no future dates, nothing before 2020). */
export function parseServiceDate(value: unknown, now = new Date()): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Invalid service date. Use the date the service was completed.");
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 2)); // 12-1 pm Melbourne: never shifts the calendar day
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("Invalid service date.");
  // "Future" is judged on the Melbourne calendar, the dates staff actually see.
  const melbourneToday = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Australia/Melbourne" }).format(now);
  if (year < 2020 || text > melbourneToday) throw new Error("Invalid service date: it cannot be in the future.");
  return date.toISOString();
}

/** Records a completed service: resets the since-service count and the alert level, and logs who did it. */
export async function recordGateService(gateId: string, servicedAt: string, user: PortalUser) {
  const gate = GATES.find((candidate) => candidate.id === gateId);
  if (!gate || !gate.active) throw new Error("Service records are blocked for inactive or unknown gates.");
  const d1 = getSql();
  await d1.batch([
    // Logged first so the entry can quote the count being reset.
    d1.prepare(
      `INSERT INTO activity_log (action, detail, category, actor_name, actor_role)
       SELECT 'Gate service recorded',
              ? || ': service completed ' || ? || ' recorded by ' || ? || '. Operations since last service reset to 0 (was '
                || COALESCE((SELECT operations_since_service FROM gate_service_counters WHERE gate_id = ?), 0)::text || ').',
              'maintenance', ?, ?`,
    ).bind(gate.name, dateText(servicedAt), user.displayName, gateId, user.displayName, user.role),
    d1.prepare(
      `INSERT INTO gate_service_counters (gate_id, total_operations, operations_since_service, last_service_at, alert_level, updated_at)
       VALUES (?, 0, 0, ?::timestamptz, 0, now())
       ON CONFLICT (gate_id) DO UPDATE SET operations_since_service = 0, alert_level = 0,
         last_service_at = excluded.last_service_at, updated_at = now()`,
    ).bind(gateId, servicedAt),
  ]);
}
