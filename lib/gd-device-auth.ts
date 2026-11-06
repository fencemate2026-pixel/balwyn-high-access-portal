/**
 * Signed requests from a site Pi (Thomastown swing gate) to the portal. Pure: no I/O.
 *
 * The Pi and the portal share one secret per device (portal: App Service setting, Pi: root-only
 * env file). Every request carries
 *   x-gd-device  device id          x-gd-ts   unix seconds        x-gd-nonce  random, single use
 *   x-gd-sig     hex HMAC-SHA256(secret, `${device}.${ts}.${nonce}.${sha256hex(body)}`)
 * so a captured request cannot be changed (body is in the MAC), re-sent (nonce is single use,
 * enforced by the store) or used late (timestamp window). The secret is a KEYED HMAC key, never
 * the unkeyed SHA-256 the old Supabase producer used.
 */
export const SIGN_WINDOW_S = 120;
const DEVICE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time comparison of two equal-length hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signDeviceRequest(secret: string, device: string, ts: number, nonce: string, body: string): Promise<string> {
  return hmacHex(secret, `${device}.${ts}.${nonce}.${await sha256Hex(body)}`);
}

export type DeviceAuth = { ok: true; device: string; nonce: string } | { ok: false; reason: "secret_missing" | "headers" | "stale" | "signature" };

/** Verify a request. Never throws and never says which part of the signature was wrong. */
export async function verifyDeviceRequest(opts: {
  headers: { get(name: string): string | null }; body: string; secrets: Record<string, string | undefined>; nowMs?: number;
}): Promise<DeviceAuth> {
  const device = opts.headers.get("x-gd-device") ?? "";
  const tsRaw = opts.headers.get("x-gd-ts") ?? "";
  const nonce = opts.headers.get("x-gd-nonce") ?? "";
  const sig = (opts.headers.get("x-gd-sig") ?? "").toLowerCase();
  if (!DEVICE.test(device) || !/^\d{9,12}$/.test(tsRaw) || !NONCE.test(nonce) || !HEX64.test(sig)) return { ok: false, reason: "headers" };
  const secret = opts.secrets[device];
  if (!secret || secret.length < 32) return { ok: false, reason: "secret_missing" };
  const ts = Number(tsRaw);
  if (Math.abs((opts.nowMs ?? Date.now()) / 1000 - ts) > SIGN_WINDOW_S) return { ok: false, reason: "stale" };
  const want = await signDeviceRequest(secret, device, ts, nonce, opts.body);
  return sameHex(want, sig) ? { ok: true, device, nonce } : { ok: false, reason: "signature" };
}
