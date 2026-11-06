// Mildura Pi -> portal (Azure). Speaks the wire protocol of the retired Supabase gd-mirror function (v3) EXACTLY,
// so mildura_mirror.py needs only its MIRROR_URL changed: POST JSON {device_id, secret, action}, action = push | key | commands | ack.
// Auth: the body's device_id must be this site's device and sha256(secret) must equal gd.devices.secret_sha256
// (constant-time compare). The secret is never stored or logged. Every auth failure answers the same bare 401 after a short delay.
// Outbound-only for the Pi: nothing here can reach or move the gate; the Pi decides what it applies.
import { gdTransaction } from "@/lib/gd-db";
import { MILDURA_DEVICE_ID, ackCommands, applyPush, findUnit, heartbeat, registerKey, takeCommands } from "@/lib/gd-mildura-store";
import { readBoundedText } from "@/lib/request-body";

const BODY_MAX_BYTES = 1_048_576;
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const denied = async () => { await sleep(400); return json({ error: "auth" }, 401); };

export async function handleMilduraPost(request: Request): Promise<Response> {
  const raw = await readBoundedText(request, BODY_MAX_BYTES);
  if (raw === null) return json({ error: "too_large" }, 413);
  let b: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    b = parsed as Record<string, unknown>;
  } catch { return json({ error: "json" }, 400); }
  const deviceId = String(b.device_id ?? ""), secret = String(b.secret ?? "");
  if (deviceId !== MILDURA_DEVICE_ID || secret.length < 32) return denied();
  try {
    const unit = await gdTransaction((c) => findUnit(c, deviceId));
    if (!unit?.secret_sha256 || !safeEq(await sha256hex(secret), unit.secret_sha256)) { console.warn("mildura_device_rejected"); return denied(); }
    switch (b.action) {
      case "key": {
        const out = await gdTransaction((c) => registerKey(c, deviceId, b.pubkey));
        return out ? json({ ok: true, registered: out.registered }) : json({ error: "pubkey" }, 400);
      }
      case "commands": return json({ ok: true, commands: await gdTransaction((c) => takeCommands(c, deviceId)) });
      case "ack": await gdTransaction((c) => ackCommands(c, deviceId, b.results)); return json({ ok: true });
      case "push":
        await gdTransaction((c) => heartbeat(c, deviceId, b.status, b.fw_version));
        // One transaction: either every table is written or none, so the Pi (which advances its marks only on ok) simply retries.
        await gdTransaction((c) => applyPush(c, deviceId, b));
        return json({ ok: true });
      default: return json({ error: "action" }, 400);
    }
  } catch {
    console.warn("mildura_device_failed");          // never log the error object: it could carry PINs or names
    return json({ ok: false, error: "store" }, 503);
  }
}
