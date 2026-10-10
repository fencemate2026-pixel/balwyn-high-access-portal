import { getSql } from "@/db";

export type HelpEventStatus = "answered" | "not_connected" | "unavailable" | "no_match" | "error";
export type HelpEventMode = "ai" | "knowledge" | "error";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /\b(ghp_|github_pat_|sk-|re_|Bearer\s+)\S+/gi;
// "password is X", "code: 123456", "token=abc" → keep the word, mask the value.
const LABELLED_SECRET = /\b(password|passcode|pin|code|token|key|secret)(\s*(?:is|=|:)\s*)\S+/gi;
// "my password hunter2" (no "is"): mask the word after the strongest labels too.
const LOOSE_SECRET = /\b(password|passcode|pin|token|secret)(\s+)(?!is\b|=|:)([^\s,.;!?]+)/gi;
const LONG_RANDOM = /\b[A-Za-z0-9_-]{24,}\b/g;
const SIX_DIGITS = /\b\d{6}\b/g;

/** Masks emails, passwords, codes and token-like strings typed into a help question. */
export function scrubHelpQuestion(value: string) {
  return value
    .replace(EMAIL, "[email]")
    .replace(SECRET, "[redacted]")
    .replace(LABELLED_SECRET, "$1$2[redacted]")
    .replace(LOOSE_SECRET, "$1$2[redacted]")
    .replace(LONG_RANDOM, "[redacted]")
    .replace(SIX_DIGITS, "[code]")
    .slice(0, 1500);
}

export async function recordHelpEvent(input: {
  role: string;
  page: string;
  question: string;
  status: string;
  mode: string;
  articleId?: string | null;
  issue?: string | null;
}) {
  const role = ["viewer", "operator", "administrator"].includes(input.role) ? input.role : "viewer";
  const status: HelpEventStatus = ["answered", "not_connected", "unavailable", "no_match", "error"].includes(input.status)
    ? input.status as HelpEventStatus
    : "error";
  const mode: HelpEventMode = ["ai", "knowledge", "error"].includes(input.mode) ? input.mode as HelpEventMode : "error";
  try {
    await getSql().prepare(
      `INSERT INTO help_events (actor_role, page, question, status, mode, article_id, issue)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      role,
      String(input.page || "dashboard").slice(0, 40),
      scrubHelpQuestion(input.question),
      status,
      mode,
      input.articleId ? String(input.articleId).slice(0, 80) : null,
      input.issue ? String(input.issue).slice(0, 240) : null,
    ).run();
  } catch {
    // Learning log must never break help.
    return;
  }
  try {
    // Retention: 12 months. Separate statement so a missing DELETE grant never blocks logging.
    await getSql().prepare("DELETE FROM help_events WHERE created_at < now() - interval '365 days'").run();
  } catch { /* retention is best effort */ }
}

export async function listHelpEvents(limit = 80) {
  const safe = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const rows = await getSql().prepare(
    `SELECT id, created_at, actor_role, page, question, status, mode, article_id, issue
       FROM help_events
      ORDER BY created_at DESC
      LIMIT ?`,
  ).bind(safe).all<{
    id: string;
    created_at: string;
    actor_role: string;
    page: string;
    question: string;
    status: string;
    mode: string;
    article_id: string | null;
    issue: string | null;
  }>();
  return rows.results ?? [];
}
