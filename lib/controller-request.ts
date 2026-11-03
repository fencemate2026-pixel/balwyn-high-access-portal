/**
 * Shared front door for the gate-controller endpoints (heartbeat, command poll,
 * acknowledgement). Hardening 10 Oct 2026:
 *  - a request without a well-formed "Authorization: Bearer <token>" header is
 *    refused before the body is read or the database is touched;
 *  - bodies over 8 KB are refused (a controller message is a few hundred bytes);
 *  - the body must be a JSON object.
 * The token itself is still verified per gate by controllerTokenValid().
 */
import { getSql } from "@/db";
import { takeActionSlot, personKey } from "@/lib/action-rate-limit";
import { clientAddress } from "@/lib/client-address";
import { readBoundedText } from "@/lib/request-body";

const MAX_BODY = 8192;
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/;

export type ControllerRequest =
  | { ok: true; token: string; body: Record<string, unknown> }
  | { ok: false; response: Response };

const refuse = (error: string, status: number): ControllerRequest => ({ ok: false, response: Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) });

export async function readControllerRequest(request: Request): Promise<ControllerRequest> {
  const match = (request.headers.get("authorization") ?? "").trim().match(BEARER);
  if (!match) return refuse("Controller authentication failed.", 401);
  const text = await readBoundedText(request, MAX_BODY);
  if (text === null) return refuse("Controller message is too large.", 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { ok: true, token: match[1], body: body as Record<string, unknown> };
  } catch {
    return refuse("Invalid controller message.", 400);
  }
}

/**
 * Failed-token limit for the controller endpoints (4 Nov 2026 audit).
 *
 * A real controller never fails authentication, so only FAILED attempts are counted, per
 * client address (the platform-set address from client-address.ts, not a browser header).
 * At CONTROLLER_FAIL_MAX failures inside CONTROLLER_FAIL_WINDOW_MS the address is refused with
 * 429 for every request until the oldest failure ages out, which stops token guessing.
 * TRADEOFF: a controller on a shared carrier address (SIM) could be refused if someone else
 * on that same address fails 20 times in 10 minutes; its own heartbeats then resume by themselves.
 * Throws if the database is unreachable (the routes' existing catch returns 503: fail closed).
 */
export const CONTROLLER_FAIL_MAX = 20;
export const CONTROLLER_FAIL_WINDOW_MS = 10 * 60 * 1000;

const failureKey = (request: Request) => personKey("ctrl-fail:addr", clientAddress(request));

/** Returns a 429 response when this address has used up its failed attempts, otherwise null. */
export async function controllerFailureBlock(request: Request): Promise<Response | null> {
  const key = await failureKey(request);
  const cutoff = new Date(Date.now() - CONTROLLER_FAIL_WINDOW_MS).toISOString();
  const row = await getSql().prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE fingerprint = ? AND created_at > ?").bind(key, cutoff).first<{ n: number }>();
  if (Number(row?.n ?? 0) < CONTROLLER_FAIL_MAX) return null;
  return Response.json({ error: "Too many failed attempts. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(CONTROLLER_FAIL_WINDOW_MS / 1000) } });
}

/** Records one failed attempt and returns the standard 401. */
export async function controllerAuthFailed(request: Request): Promise<Response> {
  await takeActionSlot(await failureKey(request), CONTROLLER_FAIL_MAX, CONTROLLER_FAIL_WINDOW_MS);
  return Response.json({ error: "Controller authentication failed." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
