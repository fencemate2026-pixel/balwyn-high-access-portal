/**
 * Shared front door for the gate-controller endpoints (heartbeat, command poll,
 * acknowledgement). Hardening 10 Oct 2026:
 *  - a request without a well-formed "Authorization: Bearer <token>" header is
 *    refused before the body is read or the database is touched;
 *  - bodies over 8 KB are refused (a controller message is a few hundred bytes);
 *  - the body must be a JSON object.
 * The token itself is still verified per gate by controllerTokenValid().
 */
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
