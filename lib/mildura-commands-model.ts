/**
 * Mildura Phase 2 (4 Nov 2026) — portal → Pi commands. Pure validation + sealing; no I/O.
 *
 * Rules mirror deploy/mildura/pi/mildura_commands.py (the Pi re-validates everything).
 * PINs and phone numbers are split out of `args` into `secrets`, which only ever leave this
 * module as RSA-OAEP ciphertext sealed to the Pi's own public key and bound to the command id.
 * They are never returned, logged, or stored in plaintext anywhere in the cloud.
 */
import { OwnerSiteInputError } from "@/lib/owner-sites-model";

export const MIRROR_KINDS = [
  "user.add", "user.update", "user.delete", "user.enable", "users.enable_all",
  "schedule.add", "schedule.enable", "schedule.delete", "person.add", "person.delete",
] as const;
export type MirrorKind = typeof MIRROR_KINDS[number];
/** Gate actuation is blocked until we have the gate app's source / local control API. */
export const GATE_KINDS = ["gate.open", "gate.hold", "gate.lockdown"] as const;
export const GATE_BLOCKED_NOTE = "Open Gate, Hold Open and Lockdown are not wired yet: the Mildura gate app exposes only /api/status, and this service never drives GPIO directly.";

export type MirrorSecrets = { pin?: string; phone?: string };
export type MirrorCommandInput = { kind: MirrorKind; args: Record<string, unknown>; secrets: MirrorSecrets | null; clientKey: string; summary: string };

const PIN = /^\d{4,6}$/;
const PHONE = /^\+?[0-9 ]{8,16}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bad = (m: string): never => { throw new OwnerSiteInputError(m); };

function name(v: unknown, field = "Name") {
  const s = typeof v === "string" ? v.trim() : "";
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 60 || /[\u0000-\u001f\u007f]/.test(s)) bad(`${field} must be 1-60 characters.`);
  if (/\d{4,}/.test(s)) bad(`${field} cannot contain a run of 4 or more digits (it could be mistaken for a PIN).`);
  return s;
}
const localId = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? v as number : bad("Unknown entry."));
const flag = (v: unknown) => (typeof v === "boolean" ? v : bad("Enabled must be on or off."));
export function pinInput(v: unknown) { return typeof v === "string" && PIN.test(v) ? v : bad("PIN must be 4 to 6 digits."); }
function time(v: unknown, f: string) { return typeof v === "string" && TIME.test(v) ? v : bad(`${f} must be HH:MM (24 hour).`); }
function days(v: unknown) {
  const d = Array.isArray(v) ? v : [];
  if (!d.length || d.length > 7 || d.some((x) => !Number.isInteger(x) || x < 0 || x > 6) || new Set(d).size !== d.length) bad("Pick at least one day.");
  return [...d as number[]].sort((a, b) => a - b);
}
function userSchedule(body: Record<string, unknown>) {
  const t = body.schedule_type ?? "always";
  if (t === "always") return { schedule_type: "always", schedule_data: null };
  if (typeof t !== "string" || !/^[a-z_]{1,40}$/.test(t)) bad("Schedule type is not valid.");
  const d = body.schedule_data;
  if (typeof d !== "string" || d.length > 2000) bad("Schedule details are missing.");
  try { JSON.parse(d as string); } catch { bad("Schedule details are not valid."); }
  return { schedule_type: t as string, schedule_data: d as string };
}

/** Validate a browser request into a queueable command. Secrets are separated from args. */
export function mirrorCommandInput(body: Record<string, unknown>): MirrorCommandInput {
  const kind = body.kind;
  if ((GATE_KINDS as readonly unknown[]).includes(kind)) bad(GATE_BLOCKED_NOTE);
  if (!(MIRROR_KINDS as readonly unknown[]).includes(kind)) bad("Unknown action.");
  const clientKey = typeof body.clientKey === "string" && UUID.test(body.clientKey) ? body.clientKey : bad("Reload the page and try again.");
  const k = kind as MirrorKind;
  let args: Record<string, unknown> = {}, secrets: MirrorSecrets | null = null, summary = "";
  switch (k) {
    case "user.add": {
      const n = name(body.name);
      args = { name: n, enabled: body.enabled === undefined ? true : flag(body.enabled), ...userSchedule(body) };
      secrets = { pin: pinInput(body.pin) }; summary = `Add user ${n}`; break;
    }
    case "user.update": {
      args = { local_id: localId(body.local_id) };
      if (body.name !== undefined) args.name = name(body.name);
      if (body.schedule_type !== undefined) Object.assign(args, userSchedule(body));
      if (body.pin !== undefined && body.pin !== "") secrets = { pin: pinInput(body.pin) };
      if (Object.keys(args).length === 1 && !secrets) bad("Nothing to change.");
      summary = `Edit user #${args.local_id}${args.name ? ` (${args.name})` : ""}${secrets ? " incl. new PIN" : ""}`; break;
    }
    case "user.delete": args = { local_id: localId(body.local_id) }; summary = `Delete user #${args.local_id}`; break;
    case "user.enable": args = { local_id: localId(body.local_id), enabled: flag(body.enabled) }; summary = `${args.enabled ? "Enable" : "Disable"} user #${args.local_id}`; break;
    case "users.enable_all": args = { enabled: flag(body.enabled) }; summary = `${args.enabled ? "Enable" : "Disable"} ALL users`; break;
    case "schedule.add": {
      const o = time(body.open_time, "Open time"), c = time(body.close_time, "Close time");
      if (o === c) bad("Open and close time cannot be the same.");
      args = { name: name(body.name), days: days(body.days), open_time: o, close_time: c };
      summary = `Add auto-open ${args.name} ${o}-${c}`; break;
    }
    case "schedule.enable": args = { local_id: localId(body.local_id), enabled: flag(body.enabled) }; summary = `${args.enabled ? "Enable" : "Disable"} auto-open #${args.local_id}`; break;
    case "schedule.delete": args = { local_id: localId(body.local_id) }; summary = `Delete auto-open #${args.local_id}`; break;
    case "person.add": {
      args = { name: name(body.name), role: body.role ? name(body.role, "Role") : "" };
      const s: MirrorSecrets = {};
      if (body.phone) s.phone = typeof body.phone === "string" && PHONE.test(body.phone) ? body.phone : bad("Phone number is not valid.");
      if (body.pin) s.pin = pinInput(body.pin);
      secrets = Object.keys(s).length ? s : null; summary = `Add authorised person ${args.name}`; break;
    }
    case "person.delete": args = { local_id: localId(body.local_id) }; summary = `Delete authorised person #${args.local_id}`; break;
  }
  return { kind: k, args, secrets, clientKey, summary };
}

const PEM_RE = /-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----/;
const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };

/** RSA-OAEP / SHA-256 (MGF1 SHA-256) to the Pi's SPKI public key; plaintext names the command id. */
export async function sealSecrets(pubkeyPem: string, secrets: MirrorSecrets, commandId: string) {
  const m = PEM_RE.exec(pubkeyPem ?? "");
  if (!m) throw new OwnerSiteInputError("The Mildura Pi has not registered its command key yet.");
  const der = Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify({ ...secrets, cmd: commandId }));
  return b64(new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, plain)));
}

/** sha256 of the PEM text — the same value install.sh prints on the Pi, so Jarrod can compare. */
export async function keyFingerprint(pem: string | null | undefined) {
  if (!pem) return null;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pem));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Melbourne wall-clock "YYYY-MM-DD HH:MM:SS", matching the Pi's naive local timestamps. */
export function melbourneNow(d = new Date()) {
  return d.toLocaleString("sv-SE", { timeZone: "Australia/Melbourne", hour12: false }).slice(0, 19);
}
