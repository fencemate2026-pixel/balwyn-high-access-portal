// Thomastown swing gate Pi → portal (Azure). 6 Nov 2026 (Jarrod): the owner sees every caller and every
// call, and changes the caller list, from the Magic Keys portal. The Pi's own database stays the
// authority; this route only mirrors it and hands the Pi the owner's queued changes.
// Auth: keyed HMAC over the body (lib/gd-device-auth.ts), single-use nonce, 120 s window. No cookies,
// no CORS, POST only. Every failure answers the same bare 401 so nothing is learnt by probing.
import { gdTransaction } from "@/lib/gd-db";
import { verifyDeviceRequest } from "@/lib/gd-device-auth";
import { PUSH_MAX_BYTES, SWING_DEVICE_ID, pushInput } from "@/lib/gd-swing-model";
import { ackCommand, applyPush, deviceKnown, takeCommands, useNonce } from "@/lib/gd-swing-store";
import { env } from "@/lib/server-env";
import { readBoundedText } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const denied = () => json({ error: "Unauthorised." }, 401);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: Request) {
  const raw = await readBoundedText(request, PUSH_MAX_BYTES);
  if (raw === null) return json({ error: "Too large." }, 413);
  // The signature covers the exact bytes received, so verify BEFORE parsing anything.
  const auth = await verifyDeviceRequest({ headers: request.headers, body: raw, secrets: { [SWING_DEVICE_ID]: env.GD_THOMASTOWN_SWING_SECRET } });
  if (!auth.ok) { console.warn("gd_device_rejected", auth.reason); return denied(); }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "Invalid request." }, 400); }
  try {
    return await gdTransaction(async (c) => {
      if (!(await deviceKnown(c, auth.device))) return denied();
      if (!(await useNonce(c, auth.device, auth.nonce))) { console.warn("gd_device_rejected", "replay"); return denied(); }
      switch (body.action) {
        case "push": return json({ ok: true, stored: await applyPush(c, auth.device, pushInput(body)) });
        case "commands": return json({ ok: true, commands: await takeCommands(c, auth.device) });
        case "ack": {
          if (typeof body.id !== "string" || !UUID.test(body.id) || typeof body.ok !== "boolean") return json({ error: "Invalid request." }, 400);
          const result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result as Record<string, unknown> : null;
          return json({ ok: true, recorded: await ackCommand(c, auth.device, body.id, body.ok, typeof body.error === "string" ? body.error : null, result) });
        }
        default: return json({ error: "Unknown action." }, 400);
      }
    });
  } catch {
    console.warn("gd_device_failed");           // never log the error object: it could carry caller data
    return json({ error: "Not available right now." }, 503);
  }
}
