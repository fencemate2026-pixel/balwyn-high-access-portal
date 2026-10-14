// Staff time-on-portal and button-press record (15 Oct 2026).
//
// Time is measured by the SERVER: each heartbeat adds the gap since the previous
// heartbeat of the same session, but only when that gap is 90 seconds or less
// (longer means the person was away) and never more than 60 s per heartbeat.
// A browser therefore cannot claim more time than the wall clock allows, and a
// session id cannot be reused by a different account.
//
// Recorded: who, when, how long, and the LABEL of each button/link pressed.
// Never recorded: typed text, passwords, field values, page contents.
import { getSql } from "@/db";
import type { PortalUser } from "@/lib/portal-model";

export const HEARTBEAT_MIN_GAP_S = 5;
export const IDLE_GAP_S = 90;
export const MAX_CREDIT_S = 60;
export const MAX_EVENTS_PER_BEAT = 40;
export const EVENT_LABEL_MAX = 120;
export const RETENTION_MONTHS = 12;

// C0/C1 control characters and the Unicode line/paragraph separators.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable key for a person: the account id for staff accounts, else the lower-case email. */
export function accountKeyFor(user: Pick<PortalUser, "accountId" | "email">): string {
  return String(user.accountId || user.email || "").trim().toLowerCase().slice(0, 254);
}

/** Label text only: control characters removed, spaces collapsed, length capped. */
export function cleanLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, EVENT_LABEL_MAX);
}

export type HeartbeatResult = { counted: boolean; activeSeconds: number; events: number };

export async function recordHeartbeat(
  user: PortalUser,
  input: { sessionId: unknown; events?: unknown },
  now: Date = new Date(),
): Promise<HeartbeatResult> {
  const none: HeartbeatResult = { counted: false, activeSeconds: 0, events: 0 };
  const sessionId = typeof input.sessionId === "string" && UUID.test(input.sessionId) ? input.sessionId.toLowerCase() : "";
  const key = accountKeyFor(user);
  if (!sessionId || !key) return none;
  const stamp = now.toISOString();
  const sql = getSql();
  const row = await sql.prepare(`INSERT INTO staff_presence (session_id, account_key, actor_name, actor_role, started_at, last_seen_at)
    VALUES (?::uuid, ?, ?, ?, ?::timestamptz, ?::timestamptz)
    ON CONFLICT (session_id) DO UPDATE SET
      active_seconds = LEAST(86400, staff_presence.active_seconds + CASE
        WHEN ?::timestamptz - staff_presence.last_seen_at <= make_interval(secs => ${IDLE_GAP_S})
        THEN LEAST(${MAX_CREDIT_S}, EXTRACT(EPOCH FROM (?::timestamptz - staff_presence.last_seen_at))::int)
        ELSE 0 END),
      last_seen_at = ?::timestamptz,
      actor_name = EXCLUDED.actor_name,
      actor_role = EXCLUDED.actor_role
    WHERE staff_presence.account_key = EXCLUDED.account_key
      AND ?::timestamptz - staff_presence.last_seen_at >= make_interval(secs => ${HEARTBEAT_MIN_GAP_S})
    RETURNING active_seconds, (xmax = 0) AS inserted`)
    .bind(sessionId, key, user.displayName.slice(0, 200), user.role, stamp, stamp, stamp, stamp, stamp, stamp)
    .first<{ active_seconds: number | string; inserted: boolean }>();
  // No row: the session id belongs to another account, or the beat came faster than the minimum gap.
  if (!row) return none;

  const labels = (Array.isArray(input.events) ? input.events : [])
    .slice(0, MAX_EVENTS_PER_BEAT)
    .map((event) => cleanLabel((event as { label?: unknown } | null)?.label))
    .filter(Boolean);
  if (labels.length) {
    await sql.batch(labels.map((label) => sql.prepare(
      "INSERT INTO staff_ui_events (session_id, account_key, actor_name, kind, label, created_at) VALUES (?::uuid, ?, ?, 'press', ?, ?::timestamptz)",
    ).bind(sessionId, key, user.displayName.slice(0, 200), label, stamp)));
  }
  // A new session is the moment to drop records past retention.
  if (row.inserted) {
    try {
      const cutoff = new Date(now); cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
      await sql.batch([
        sql.prepare("DELETE FROM staff_presence WHERE started_at < ?::timestamptz").bind(cutoff.toISOString()),
        sql.prepare("DELETE FROM staff_ui_events WHERE created_at < ?::timestamptz").bind(cutoff.toISOString()),
      ]);
    } catch { /* retention is housekeeping; never fail a heartbeat for it */ }
  }
  return { counted: true, activeSeconds: Number(row.active_seconds) || 0, events: labels.length };
}

export type StaffUsage = { account_key: string; sessions: number; total_seconds: number; week_seconds: number; last_seen_at: string | null };

/** Time on portal per person, keyed by account id (or lower-case email). */
export async function staffUsageSummary(now: Date = new Date()): Promise<StaffUsage[]> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const result = await getSql().prepare(`SELECT account_key, count(*) AS sessions,
      COALESCE(sum(active_seconds), 0) AS total_seconds,
      COALESCE(sum(active_seconds) FILTER (WHERE started_at >= ?::timestamptz), 0) AS week_seconds,
      max(last_seen_at) AS last_seen_at
    FROM staff_presence GROUP BY account_key`).bind(weekAgo).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({
    account_key: String(row.account_key),
    sessions: Number(row.sessions) || 0,
    total_seconds: Number(row.total_seconds) || 0,
    week_seconds: Number(row.week_seconds) || 0,
    last_seen_at: row.last_seen_at ? new Date(String(row.last_seen_at)).toISOString() : null,
  }));
}

export type StaffDetail = {
  sessions: { started_at: string; last_seen_at: string; active_seconds: number }[];
  presses: { at: string; label: string }[];
  actions: { id: number; at: string; action: string; detail: string; category: string }[];
};

/** Recent sessions, button presses and logged portal actions for one person. */
export async function staffDetail(accountKey: string, displayName: string): Promise<StaffDetail> {
  const sql = getSql();
  const [sessions, presses, actions] = await Promise.all([
    sql.prepare("SELECT started_at, last_seen_at, active_seconds FROM staff_presence WHERE account_key = ? ORDER BY started_at DESC LIMIT 30").bind(accountKey).all<Record<string, unknown>>(),
    sql.prepare("SELECT created_at, label FROM staff_ui_events WHERE account_key = ? ORDER BY id DESC LIMIT 200").bind(accountKey).all<Record<string, unknown>>(),
    sql.prepare("SELECT id, created_at, action, detail, category FROM activity_log WHERE actor_name = ? ORDER BY id DESC LIMIT 100").bind(displayName).all<Record<string, unknown>>(),
  ]);
  const iso = (value: unknown) => new Date(String(value)).toISOString();
  return {
    sessions: (sessions.results ?? []).map((r) => ({ started_at: iso(r.started_at), last_seen_at: iso(r.last_seen_at), active_seconds: Number(r.active_seconds) || 0 })),
    presses: (presses.results ?? []).map((r) => ({ at: iso(r.created_at), label: String(r.label) })),
    actions: (actions.results ?? []).map((r) => ({ id: Number(r.id), at: String(r.created_at), action: String(r.action), detail: String(r.detail), category: String(r.category) })),
  };
}
