import { getSql } from "@/db";

export type HelpEventStatus = "answered" | "not_connected" | "unavailable" | "no_match" | "error";
export type HelpEventMode = "ai" | "knowledge" | "error";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /\b(ghp_|github_pat_|sk-|Bearer\s+)\S+/gi;

export function scrubHelpQuestion(value: string) {
  return value.replace(EMAIL, "[email]").replace(SECRET, "[redacted]").slice(0, 1500);
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
  }
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
