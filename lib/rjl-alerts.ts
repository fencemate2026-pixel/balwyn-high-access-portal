/**
 * RJL alerts: messages the portal sends to RJL Commercial (never to school staff).
 *
 * Used for: gate service due / service early warning, help-assistant
 * questions flagged as misuse or security probing, and system issues RJL must
 * fix (for example the help AI provider rejecting requests).
 *
 * Every alert is written to balwyn_portal.rjl_notifications FIRST, then emailed.
 * If email is not configured, or the email provider fails, the alert is still on
 * record (delivery = not_configured / failed) and nothing in the calling feature
 * breaks: sendRjlAlert never throws.
 *
 * Email provider: Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email):
 *   POST https://api.resend.com/emails, Authorization: Bearer <key>,
 *   JSON { from, to, subject, text }, optional Idempotency-Key header.
 * Server settings (Render > Environment):
 *   RESEND_API_KEY   required to send email (without it alerts are recorded only)
 *   RJL_ALERT_TO     recipient, default info@rjlcommercialgroup.com
 *   RJL_ALERT_FROM   sender, default "Magic Keys Portal <onboarding@resend.dev>"
 *                    (Resend only allows resend.dev senders to email the address
 *                    the Resend account was opened with; verify the RJL domain in
 *                    Resend to send from an @rjlcommercialgroup.com address.)
 *
 * Server-only module. Never import into a client component.
 */
import { getSql } from "@/db";
import { env } from "@/lib/server-env";

export type RjlAlertKind = "service_due" | "service_warning" | "help_flag" | "system_issue" | "gate_fault";
export type RjlAlert = { kind: RjlAlertKind; subject: string; body: string; idempotencyKey?: string };
export type AlertDelivery = "sent" | "failed" | "not_configured" | "not_recorded";

const DEFAULT_TO = "info@rjlcommercialgroup.com";
const DEFAULT_FROM = "Magic Keys Portal <onboarding@resend.dev>";
const PLAIN_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const NAMED_EMAIL = /^[^<>\r\n]{1,80} <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/;
const RETENTION_DAYS = 365;

type Runtime = Record<string, string | undefined>;
type AlertOptions = { fetcher?: typeof fetch; runtime?: Runtime };

/** Removes control characters (header injection) and trims to a length. */
function clean(value: string, max: number) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** Resolves sender/recipient from server settings, refusing anything malformed. */
export function alertAddresses(runtime: Runtime) {
  const to = (runtime.RJL_ALERT_TO ?? "").trim() || DEFAULT_TO;
  const from = (runtime.RJL_ALERT_FROM ?? "").trim() || DEFAULT_FROM;
  return {
    to: PLAIN_EMAIL.test(to) ? to : DEFAULT_TO,
    from: PLAIN_EMAIL.test(from) || NAMED_EMAIL.test(from) ? from : DEFAULT_FROM,
  };
}

async function recordAlert(alert: RjlAlert): Promise<string | null> {
  const d1 = getSql();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const [, inserted] = await d1.batch<{ id: string }>([
    d1.prepare("DELETE FROM rjl_notifications WHERE created_at < ?::timestamptz").bind(cutoff),
    d1.prepare("INSERT INTO rjl_notifications (kind, subject, body) VALUES (?, ?, ?) RETURNING id").bind(alert.kind, alert.subject, alert.body),
  ]);
  return inserted?.results?.[0]?.id ? String(inserted.results[0].id) : null;
}

async function markDelivery(id: string | null, delivery: Exclude<AlertDelivery, "not_recorded">, error: string | null) {
  if (!id) return;
  try {
    await getSql().prepare("UPDATE rjl_notifications SET delivery = ?, sent_at = CASE WHEN ? = 'sent' THEN now() ELSE NULL END, error = ? WHERE id = ?::uuid")
      .bind(delivery, delivery, error, id).run();
  } catch { /* the alert itself is already recorded */ }
}

/**
 * Retries up to 3 alerts from the last 24 hours that were not delivered
 * (provider failure, timeout, or recorded before an email key was set), oldest
 * first, skipping anything newer than 5 minutes. Each retry carries a stable
 * Idempotency-Key so the email provider drops duplicates. Never throws.
 */
async function retryUndelivered(skipId: string | null, settings: { apiKey: string; to: string; from: string; fetcher?: typeof fetch }) {
  try {
    const pending = await getSql().prepare(
      `SELECT id, subject, body FROM rjl_notifications
        WHERE delivery IN ('failed', 'not_configured') AND created_at > now() - interval '24 hours'
          AND created_at < now() - interval '5 minutes' AND id <> COALESCE(?::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY created_at LIMIT 3`,
    ).bind(skipId).all<{ id: string; subject: string; body: string }>();
    for (const row of pending.results ?? []) {
      try {
        const response = await (settings.fetcher ?? fetch)("https://api.resend.com/emails", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `rjl-alert-${row.id}` },
          body: JSON.stringify({ from: settings.from, to: [settings.to], subject: row.subject, text: row.body }),
        });
        await markDelivery(String(row.id), response.ok ? "sent" : "failed", response.ok ? null : `retry: provider status ${response.status}`);
      } catch {
        await markDelivery(String(row.id), "failed", "retry: request failed");
      }
    }
  } catch { /* retry is best effort */ }
}

/**
 * Records and emails one alert to RJL. Never throws; returns what happened.
 * The person whose action caused the alert is never told an alert was sent.
 */
export async function sendRjlAlert(input: RjlAlert, options: AlertOptions = {}): Promise<AlertDelivery> {
  const alert: RjlAlert = {
    kind: input.kind,
    // Subject is one line: line breaks become spaces (no header injection).
    subject: clean(input.subject.replace(/[\r\n]+/g, " "), 200) || "Magic Keys portal alert",
    body: clean(input.body.replace(/\r\n/g, "\n"), 8000) || "(no detail)",
    idempotencyKey: input.idempotencyKey ? clean(input.idempotencyKey, 200) : undefined,
  };
  let id: string | null = null;
  try { id = await recordAlert(alert); }
  catch { console.warn("rjl_alert_record_failed", JSON.stringify({ kind: alert.kind })); }

  const runtime = options.runtime ?? (env as unknown as Runtime);
  const apiKey = (runtime.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    await markDelivery(id, "not_configured", null);
    return id ? "not_configured" : "not_recorded";
  }
  const { to, from } = alertAddresses(runtime);
  try {
    const response = await (options.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(alert.idempotencyKey ? { "Idempotency-Key": alert.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to: [to], subject: alert.subject, text: alert.body }),
    });
    if (!response.ok) {
      // Status code only: provider messages can echo addresses or content.
      await markDelivery(id, "failed", `provider status ${response.status}`);
      console.warn("rjl_alert_send_failed", JSON.stringify({ kind: alert.kind, status: response.status }));
      return "failed";
    }
    await markDelivery(id, "sent", null);
    // Email works again: retry a few recent alerts that failed or were recorded
    // before email was configured. Not awaited; never throws.
    void retryUndelivered(id, { apiKey, to, from, fetcher: options.fetcher });
    return "sent";
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    await markDelivery(id, "failed", timeout ? "timeout" : "request failed");
    console.warn("rjl_alert_send_failed", JSON.stringify({ kind: alert.kind, reason: timeout ? "timeout" : "request_failed" }));
    return "failed";
  }
}
