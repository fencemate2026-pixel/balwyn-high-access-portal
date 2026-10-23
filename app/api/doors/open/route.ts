import { env } from "@/lib/server-env";
import { requireOperator } from "@/lib/portal-auth";
import { getPortalSnapshot, recordActivity } from "@/lib/portal-store";
import { handleDoorRequest, remoteOpenEnvironment } from "@/lib/door-open-gateway";
import { readEquipment } from "@/lib/equipment-store";
import { recordGateOperation } from "@/lib/gate-service";
import { personKey, takeActionSlot } from "@/lib/action-rate-limit";
import { readBoundedText } from "@/lib/request-body";
import { GATES, type PortalUser } from "@/lib/portal-model";

export const dynamic = "force-dynamic";

/*
 * Remote open (Compass door exit input via the Pi door service).
 *
 * Safeguards added 10 Oct 2026 (audit finding: remote opens were not in the
 * Activity log and were not rate limited):
 *   - every request is written to the Activity log with the person's name and
 *     role BEFORE the pulse is sent; if that record cannot be written the open
 *     is refused (no unrecorded openings);
 *   - the outcome (pulsed / not confirmed) is logged afterwards;
 *   - rate limits: 6 requests per minute per person, and one request per gate
 *     every 6 seconds (a gate cycle takes far longer than that);
 *   - a confirmed pulse adds one operation to the gate's service counter.
 */
const USER_LIMIT = { max: 6, windowMs: 60_000 };
const GATE_LIMIT = { max: 1, windowMs: 6_000 };

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads the requested gate from a byte-capped copy of the body; the gateway re-validates the original. */
async function peekGateId(request: Request): Promise<string | null> {
  try {
    const text = await readBoundedText(request.clone(), 1024);
    if (text === null) return null;
    const body = JSON.parse(text) as { gateId?: unknown };
    return typeof body?.gateId === "string" && GATES.some((gate) => gate.id === body.gateId) ? body.gateId : null;
  } catch { return null; }
}

async function logOutcome(user: PortalUser, gateId: string, requestId: string, response: Response) {
  const gateName = GATES.find((gate) => gate.id === gateId)?.name ?? gateId;
  let status = "";
  let replayed = false;
  try {
    const body = await response.clone().json() as { status?: unknown; replayed?: unknown };
    status = typeof body.status === "string" ? body.status : "";
    replayed = body.replayed === true;
  } catch { /* outcome unknown */ }
  const [action, detail] = response.ok && status === "pulsed"
    ? ["Remote open pulsed", `${gateName}: the door service confirmed the open pulse${replayed ? " (repeat of an earlier request, not pulsed again)" : ""}. Request ${requestId}.`]
    : response.ok && status === "dry_run"
      ? ["Remote open test", `${gateName}: the door service is in test mode, so no pulse was sent. Request ${requestId}.`]
      : ["Remote open not confirmed", `${gateName}: no verified pulse acknowledgement (status ${response.status}). Inspect the gate locally before another request. Request ${requestId}.`];
  try { await recordActivity(user, action, detail, "gate-command"); }
  catch { console.warn("remote_open_outcome_log_failed", JSON.stringify({ gateId, requestId })); }
  if (response.ok && status === "pulsed" && !replayed) await recordGateOperation(gateId, { unlessReedCounted: true });
}

async function handle(request: Request) {
  // Read only after the operator is authorised; null (unreadable) fails closed.
  let remoteOpenEnabled: boolean | null = null;
  let actor: PortalUser | null = null;
  let gateId: string | null = null;
  const rawRequestId = request.headers.get("Idempotency-Key") ?? "";
  // Only a well-formed request id is ever written to the (permanent) activity log.
  const requestId = REQUEST_ID.test(rawRequestId) ? rawRequestId : "";
  const runtime = (key: string) => { const value = (env as unknown as Record<string, unknown>)[key]; return typeof value === "string" ? value : undefined; };
  const response = await handleDoorRequest(request, {
    gates: GATES,
    readEnv: (key) => remoteOpenEnvironment(runtime, remoteOpenEnabled)(key),
    authorize: async (req) => {
      const auth = await requireOperator(req, req.method === "GET" ? "viewer" : "operator");
      if (!auth.user) return auth.response;
      try { remoteOpenEnabled = (await readEquipment()).remoteOpenEnabled; } catch { remoteOpenEnabled = null; }
      if (req.method !== "POST") return null;
      try {
        const snapshot = await getPortalSnapshot(auth.user);
        if (snapshot.systemMode !== "normal") return json({ error: "Manual remote open is blocked by emergency priority" }, 409);
      } catch { return json({ error: "Operating priority could not be verified" }, 503); }
      // Malformed requests are refused before they can use a rate-limit slot or
      // write to the activity log (the gateway would refuse them anyway).
      if (!requestId) return json({ error: "A request ID is required" }, 400);
      const requested = await peekGateId(req);
      if (!requested) return json({ error: "Supply a valid gateId only" }, 400);
      try {
        if (!await takeActionSlot(await personKey("remote-open:user", auth.user.email), USER_LIMIT.max, USER_LIMIT.windowMs)) {
          return json({ error: "Too many remote-open requests. Wait a minute, then try again." }, 429);
        }
        if (!await takeActionSlot(`remote-open:gate:${requested}`, GATE_LIMIT.max, GATE_LIMIT.windowMs)) {
          return json({ error: "This gate was opened a moment ago. Wait a few seconds before another request." }, 429);
        }
        const gateName = GATES.find((gate) => gate.id === requested)?.name ?? requested;
        await recordActivity(auth.user, "Remote open requested", `${gateName}: remote open requested by ${auth.user.displayName} (${auth.user.role}). Request ${requestId}.`, "gate-command");
      } catch {
        // No record, no pulse.
        return json({ error: "The request could not be recorded, so the gate was not opened. Try again shortly." }, 503);
      }
      actor = auth.user;
      gateId = requested;
      return null;
    },
  });
  if (request.method === "POST" && actor && gateId) await logOutcome(actor, gateId, requestId, response);
  return response;
}

export const GET = handle;
export const POST = handle;
