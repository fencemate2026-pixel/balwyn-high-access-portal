/**
 * Macquarie Drive Thomastown resident data.
 * Server only. Gate reads and writes use the Azure device thomastown-sliding.
 * Commands are queued for that Pi. They do not pulse a relay and they do not
 * touch thomastown-swing. Portal sign-in stays on the portal database.
 * Every change and click is also written to activity_log.
 */
import { getSql } from "@/db";
import { clientAddress } from "@/lib/client-address";
import { GdUnavailableError, gdTransaction } from "@/lib/gd-db";
import { SLIDING_DEVICE_ID, SLIDING_SITE_NAME, displayPhone, swingCommandInput } from "@/lib/gd-swing-model";
import { deviceKnown, enqueueCommand, getDetail } from "@/lib/gd-swing-store";
import {
  MACQUARIE_ONLINE_SECONDS,
  MACQUARIE_SEED_NAME,
  MACQUARIE_SITE_LABEL,
  activityLine,
  clickDetail,
  emailMaySignIn,
  holdNowWindow,
  isSeedEmail,
  loginCodeMaterial,
  plannedHold,
  portalUserName,
  residentEmail,
  unitOnline,
  windowCoversNow,
  withinRate,
  type HoldRow,
} from "@/lib/macquarie-resident";
import { macquarieSessionSecret, readResidentSession, type ResidentSession } from "@/lib/macquarie-session";
import { OwnerSiteInputError } from "@/lib/owner-sites-model";
import { recordActivity } from "@/lib/portal-store";
import { alertAddresses } from "@/lib/rjl-alerts";
import { env } from "@/lib/server-env";

const UNIFORM = "If that address can sign in, a code is on its way.";
const BAD_CODE = "That code is not valid or it has expired.";
const DB_NOT_READY = "Macquarie sign-in is not ready on the database yet, so no code was sent.";
const MAIL_OFF = "The sign-in email is not set up on this server yet, so no code was sent.";
const MAIL_FAILED = "The sign-in email could not be sent. Try again in a few minutes.";
const TOO_MANY = "A code was already sent. Wait a few minutes and use the latest one.";
const NOT_LINKED = "The sliding gate is not linked yet. Nothing on this page will change the swing gate.";
const GATE_DOWN = "The sliding gate is not available right now.";
const SAVED_UNLOGGED = "The change was saved. It did not appear on the activity timeline.";
const encoder = new TextEncoder();

const codeRequestsByIp = new Map<string, number[]>();
const verifyAttempts = new Map<string, number[]>();
const clickTimes = new Map<string, number[]>();
const refusedLogAt = new Map<string, number>();

export type PortalUserRow = { email: string; displayName: string; kept: boolean };
export type ResidentResult = { status: number; body: Record<string, unknown> };

type WindowRow = HoldRow & { id: string };
type Loaded = {
  siteId: string;
  slidingId: string | null;
  sliding: { name: string; gateType: string; online: boolean; lastSeen: string | null; ageSeconds: number | null; held: boolean } | null;
  callersWritable: boolean;
  linkNote: string | null;
  callers: { id: string; name: string; phone: string; enabled: boolean }[];
  windows: WindowRow[];
};

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /42P01|undefined_table|does not exist/i.test(message);
}

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function hhmm(value: unknown): string {
  const match = String(value ?? "").match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : "";
}

/** The Pi stores Monday as 0. This page stores Monday as 1. */
function uiDays(value: unknown): number[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.replace(/[{}]/g, "").split(",") : [];
  return [...new Set(source.map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).map((day) => day + 1).sort((a, b) => a - b);
}

function gdDays(days: number[]): number[] {
  return days.map((day) => day - 1);
}

function seenText(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  return null;
}

function localId(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function gateDown(error: unknown): boolean {
  if (error instanceof GdUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /42P01|undefined_table|does not exist/i.test(message) && /\bgd\b|hold_windows|commands/i.test(message);
}

function remember(map: Map<string, number[]>, key: string, now: number, windowMs: number, limit: number): boolean {
  if (map.size > 500) map.clear();
  const result = withinRate(map.get(key) ?? [], now, windowMs, limit);
  map.set(key, result.next);
  return result.ok;
}

function sixDigit(): string {
  const limit = 4_294_000_000;
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const value = ((bytes[0] * 2 ** 24) + (bytes[1] * 2 ** 16) + (bytes[2] * 2 ** 8) + bytes[3]) >>> 0;
    if (value < limit) return String(value % 1_000_000).padStart(6, "0");
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

async function note(user: { displayName: string; email: string }, action: string, sentence: string): Promise<boolean> {
  try {
    await recordActivity(
      { displayName: user.displayName, email: user.email, role: "viewer" },
      action.slice(0, 200),
      sentence.startsWith(MACQUARIE_SITE_LABEL) ? sentence.slice(0, 1000) : activityLine(sentence),
      "macquarie",
    );
    return true;
  } catch {
    console.warn("macquarie_activity_failed");
    return false;
  }
}

async function noteRefusal(email: string, sentence: string) {
  const now = Date.now();
  const last = refusedLogAt.get(email) ?? 0;
  if (now - last < 15 * 60 * 1000) return;
  if (refusedLogAt.size > 500) refusedLogAt.clear();
  refusedLogAt.set(email, now);
  await note({ displayName: "Macquarie visitor", email }, "Sign-in refused", sentence);
}

export async function listPortalUsers(): Promise<PortalUserRow[]> {
  const rows = await getSql().prepare(
    "SELECT email, display_name, kept FROM macquarie_portal_users ORDER BY kept DESC, display_name",
  ).all<{ email: string; display_name: string; kept: unknown }>();
  return (rows.results ?? []).map((row) => ({
    email: String(row.email).trim().toLowerCase(),
    displayName: String(row.display_name ?? "").trim() || "Resident",
    kept: asBool(row.kept),
  }));
}

export async function currentResident(request: Request): Promise<ResidentSession | null> {
  const session = await readResidentSession(request);
  if (!session) return null;
  const email = residentEmail(session.email);
  if (!email) return null;
  try {
    const rows = await listPortalUsers();
    if (!emailMaySignIn(email, rows)) return null;
    const row = rows.find((item) => item.email === email);
    return { ...session, email, displayName: row?.displayName || (isSeedEmail(email) ? MACQUARIE_SEED_NAME : session.displayName) };
  } catch (error) {
    if (missingTable(error) && isSeedEmail(email)) return { ...session, email, displayName: session.displayName || MACQUARIE_SEED_NAME };
    if (missingTable(error)) return null;
    throw error;
  }
}

async function sendCodeEmail(to: string, code: string): Promise<"sent" | "not_configured" | "failed"> {
  const apiKey = String(env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) return "not_configured";
  const from = alertAddresses(env as Record<string, string | undefined>).from;
  const subject = "Your Macquarie Drive sign-in code";
  const text = `Your Macquarie Drive Thomastown sign-in code is ${code}. It expires in 15 minutes. If you did not ask for it, ignore this email.`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) {
      console.warn("macquarie_code_email_failed", response.status);
      return "failed";
    }
    return "sent";
  } catch {
    console.warn("macquarie_code_email_failed", "request_failed");
    return "failed";
  }
}

export async function requestLoginCode(emailRaw: unknown, request: Request): Promise<{ status: number; message: string; sent: boolean }> {
  const now = Date.now();
  const ip = clientAddress(request) || "unknown";
  if (!remember(codeRequestsByIp, ip, now, 15 * 60 * 1000, 20)) return { status: 200, message: UNIFORM, sent: false };
  const email = residentEmail(emailRaw);
  if (!email) return { status: 400, message: "Enter the email address.", sent: false };

  let rows: PortalUserRow[] = [];
  try {
    rows = await listPortalUsers();
  } catch (error) {
    if (missingTable(error)) {
      if (isSeedEmail(email)) return { status: 503, message: DB_NOT_READY, sent: false };
      await noteRefusal(email, `Sign-in code was refused for ${email}`);
      return { status: 200, message: UNIFORM, sent: false };
    }
    console.warn("macquarie_users_unreadable");
    return { status: 503, message: "Sign-in is not available right now.", sent: false };
  }
  if (!emailMaySignIn(email, rows)) {
    await noteRefusal(email, `Sign-in code was refused for ${email}`);
    return { status: 200, message: UNIFORM, sent: false };
  }

  let secret = "";
  try { secret = macquarieSessionSecret(); } catch {
    return { status: 503, message: "Sign-in is not available right now.", sent: false };
  }

  try {
    const count = await getSql().prepare(
      "SELECT count(*)::int AS n FROM macquarie_login_codes WHERE lower(email) = ? AND created_at > now() - interval '15 minutes'",
    ).bind(email).first<{ n: number | string }>();
    if (Number(count?.n ?? 0) >= 5) return { status: 429, message: TOO_MANY, sent: false };
    await getSql().prepare("DELETE FROM macquarie_login_codes WHERE expires_at < now() - interval '1 day'").run();
    const code = sixDigit();
    const codeHash = await sha256(loginCodeMaterial(secret, email, code));
    const inserted = await getSql().prepare(
      "INSERT INTO macquarie_login_codes (email, code_hash, expires_at) VALUES (?, ?, now() + interval '15 minutes') RETURNING id",
    ).bind(email, codeHash).first<{ id: string }>();
    if (!inserted?.id) return { status: 503, message: DB_NOT_READY, sent: false };
    const delivery = await sendCodeEmail(email, code);
    if (delivery !== "sent") {
      await getSql().prepare("DELETE FROM macquarie_login_codes WHERE id = ?::uuid").bind(inserted.id).run();
      return { status: 503, message: delivery === "not_configured" ? MAIL_OFF : MAIL_FAILED, sent: false };
    }
    const person = rows.find((row) => row.email === email);
    await note({ displayName: person?.displayName || MACQUARIE_SEED_NAME, email }, "Asked for a sign-in code", `Asked for a sign-in code for ${email}`);
    return { status: 200, message: UNIFORM, sent: true };
  } catch (error) {
    if (missingTable(error)) return { status: 503, message: DB_NOT_READY, sent: false };
    console.warn("macquarie_code_store_failed");
    return { status: 503, message: "Sign-in is not available right now.", sent: false };
  }
}

export async function verifyLoginCode(emailRaw: unknown, codeRaw: unknown): Promise<{ ok: true; email: string; displayName: string; activityLogged: boolean } | { ok: false; status: number; message: string }> {
  const email = residentEmail(emailRaw);
  const code = String(codeRaw ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) return { ok: false, status: 401, message: BAD_CODE };
  if (!remember(verifyAttempts, email, Date.now(), 15 * 60 * 1000, 10)) return { ok: false, status: 401, message: BAD_CODE };
  let secret = "";
  try { secret = macquarieSessionSecret(); } catch {
    return { ok: false, status: 503, message: "Sign-in is not available right now." };
  }
  try {
    const rows = await listPortalUsers();
    if (!emailMaySignIn(email, rows)) return { ok: false, status: 401, message: BAD_CODE };
    const candidates = await getSql().prepare(
      "SELECT id, code_hash FROM macquarie_login_codes WHERE lower(email) = ? AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 10",
    ).bind(email).all<{ id: string; code_hash: string }>();
    const expected = await sha256(loginCodeMaterial(secret, email, code));
    let match: string | null = null;
    for (const row of candidates.results ?? []) {
      if (constantTimeEqual(String(row.code_hash), expected) && !match) match = String(row.id);
    }
    if (!match) {
      await noteRefusal(email, `A sign-in code was rejected for ${email}`);
      return { ok: false, status: 401, message: BAD_CODE };
    }
    const used = await getSql().prepare(
      "UPDATE macquarie_login_codes SET used_at = now() WHERE id = ?::uuid AND used_at IS NULL RETURNING id",
    ).bind(match).first<{ id: string }>();
    if (!used?.id) return { ok: false, status: 401, message: BAD_CODE };
    await getSql().prepare("UPDATE macquarie_login_codes SET used_at = now() WHERE lower(email) = ? AND used_at IS NULL").bind(email).run();
    const person = rows.find((row) => row.email === email);
    const displayName = person?.displayName || (isSeedEmail(email) ? MACQUARIE_SEED_NAME : "Resident");
    const activityLogged = await note({ displayName, email }, "Signed in", `Signed in as ${displayName}`);
    return { ok: true, email, displayName, activityLogged };
  } catch (error) {
    if (missingTable(error)) return { ok: false, status: 503, message: DB_NOT_READY };
    console.warn("macquarie_verify_failed");
    return { ok: false, status: 503, message: "Sign-in is not available right now." };
  }
}

export async function noteSignOut(user: ResidentSession): Promise<boolean> {
  return note(user, "Signed out", "Signed out");
}

function holdOn(status: unknown): boolean {
  let value = status;
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return false; }
  }
  return Boolean(value && typeof value === "object" && (value as { hold_on?: unknown }).hold_on === true);
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function loadSite(): Promise<Loaded> {
  const detail = await gdTransaction((client) => getDetail(client, SLIDING_DEVICE_ID));
  const device = detail.device ? recordOf(detail.device) : null;
  if (!device) {
    return {
      siteId: SLIDING_DEVICE_ID,
      slidingId: null,
      sliding: null,
      callersWritable: false,
      linkNote: NOT_LINKED,
      callers: [],
      windows: [],
    };
  }
  const now = Date.now();
  const seen = seenText(device.last_seen);
  const callers = detail.users.map((item) => {
    const row = recordOf(item);
    return {
      id: String(row.local_id),
      name: String(row.name ?? ""),
      phone: displayPhone(typeof row.phone === "string" ? row.phone : ""),
      enabled: asBool(row.enabled),
    };
  });
  const windows = detail.holds.map((item) => {
    const row = recordOf(item);
    return {
      id: String(row.local_id),
      name: String(row.name ?? "Hold open"),
      open_time: hhmm(row.open_time),
      close_time: hhmm(row.close_time),
      days: uiDays(row.days),
      span_days: 0,
      enabled: asBool(row.enabled),
    };
  }).filter((row) => row.open_time && row.close_time && row.days.length > 0);
  return {
    siteId: SLIDING_DEVICE_ID,
    slidingId: SLIDING_DEVICE_ID,
    sliding: {
      name: SLIDING_SITE_NAME,
      gateType: "sliding",
      online: unitOnline(seen, now, MACQUARIE_ONLINE_SECONDS * 2),
      lastSeen: seen,
      ageSeconds: seen ? Math.max(0, Math.round((now - Date.parse(seen)) / 1000)) : null,
      held: holdOn(device.last_status),
    },
    callersWritable: true,
    linkNote: null,
    callers,
    windows,
  };
}

async function queueSliding(email: string, body: Record<string, unknown>) {
  const input = swingCommandInput({ ...body, clientKey: crypto.randomUUID() });
  await gdTransaction(async (client) => {
    if (!(await deviceKnown(client, SLIDING_DEVICE_ID))) throw new OwnerSiteInputError(NOT_LINKED);
    await enqueueCommand(client, input, email, SLIDING_DEVICE_ID);
  });
  return input;
}

function viewOf(user: ResidentSession, loaded: Loaded | null, users: PortalUserRow[], usersNote: string | null) {
  return {
    signedIn: true,
    viewer: { email: user.email, displayName: user.displayName },
    siteLabel: MACQUARIE_SITE_LABEL,
    linkNote: loaded?.linkNote ?? "Macquarie Drive Thomastown is not on the gate list yet. Nothing on this page will change a gate.",
    usersNote,
    callersWritable: loaded?.callersWritable ?? false,
    sliding: loaded?.sliding ?? null,
    callers: loaded?.callers ?? [],
    windows: (loaded?.windows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      openTime: row.open_time,
      closeTime: row.close_time,
      days: row.days,
      spanDays: row.span_days,
      enabled: row.enabled,
    })),
    portalUsers: users,
    serverTime: new Date().toISOString(),
  };
}

export async function publicSnapshot(user: ResidentSession) {
  let loaded: Loaded | null = null;
  let gateNote: string | null = null;
  try { loaded = await loadSite(); } catch (error) {
    if (!gateDown(error)) throw error;
    gateNote = GATE_DOWN;
  }
  let users: PortalUserRow[] = [];
  let usersNote: string | null = null;
  try { users = await listPortalUsers(); } catch (error) {
    if (!missingTable(error)) throw error;
    usersNote = "The sign-in list is not ready on the database yet.";
    if (isSeedEmail(user.email)) users = [{ email: user.email, displayName: user.displayName, kept: true }];
  }
  const view = viewOf(user, loaded, users, usersNote);
  if (gateNote) view.linkNote = gateNote;
  return view;
}

function saved(user: ResidentSession, loaded: Loaded | null, users: PortalUserRow[], activityLogged: boolean, message: string): ResidentResult {
  return { status: 200, body: { ok: true, activityLogged, message: activityLogged ? message : SAVED_UNLOGGED, ...viewOf(user, loaded, users, null) } };
}

async function afterSave(user: ResidentSession, activityLogged: boolean, message: string): Promise<ResidentResult> {
  try {
    return saved(user, await loadSite(), await listPortalUsers(), activityLogged, message);
  } catch {
    return { status: 200, body: { ok: true, activityLogged, message: activityLogged ? message : SAVED_UNLOGGED, reload: true } };
  }
}

async function refuse(user: ResidentSession, sentence: string, error: string): Promise<ResidentResult> {
  const activityLogged = await note(user, "Change refused", sentence);
  return { status: 409, body: { error, activityLogged } };
}

export async function handleResidentPost(user: ResidentSession, body: Record<string, unknown>): Promise<ResidentResult> {
  if (body.action === "click") {
    if (!remember(clickTimes, user.email, Date.now(), 60_000, 60)) return { status: 429, body: { error: "Too many clicks. Wait a minute." } };
    const detail = clickDetail(body.target, body.label);
    if (!detail) return { status: 400, body: { error: "Unknown action." } };
    const activityLogged = await note(user, "Clicked", detail);
    if (!activityLogged) return { status: 200, body: { ok: false, activityLogged: false, message: "That click was not saved to the activity timeline." } };
    return { status: 200, body: { ok: true, activityLogged: true } };
  }

  try {
    if (body.action === "portal-user.add" || body.action === "portal-user.delete") return await changePortalUser(user, body);
    const loaded = await loadSite();
    if (!loaded.slidingId) return refuse(user, "The sliding gate is not linked, so the change was not saved.", loaded.linkNote ?? NOT_LINKED);
    if (body.action === "caller.add" || body.action === "caller.delete") return await changeCaller(user, loaded, body);
    if (body.action === "hold.save" || body.action === "hold.now" || body.action === "hold.end" || body.action === "hold.delete") return await changeHold(user, loaded, body);
    return { status: 400, body: { error: "Unknown action." } };
  } catch (error) {
    if (error instanceof OwnerSiteInputError) return { status: 400, body: { error: error.message } };
    if (gateDown(error)) return { status: 503, body: { error: GATE_DOWN } };
    if (missingTable(error)) return { status: 503, body: { error: "Macquarie sign-in is not ready on the database yet." } };
    console.warn("macquarie_change_failed");
    return { status: 503, body: { error: "That change could not be saved." } };
  }
}

async function changePortalUser(user: ResidentSession, body: Record<string, unknown>): Promise<ResidentResult> {
  const email = residentEmail(body.email);
  if (!email) return { status: 400, body: { error: "Enter the email address." } };
  if (body.action === "portal-user.add") {
    const name = portalUserName(body.name);
    if (!name) return { status: 400, body: { error: "Enter a name." } };
    if (isSeedEmail(email)) return { status: 400, body: { error: "That address is already on the list." } };
    const existing = await getSql().prepare("SELECT email FROM macquarie_portal_users WHERE lower(email) = ?").bind(email).first();
    if (existing) return { status: 400, body: { error: "That address is already on the list." } };
    await getSql().prepare("INSERT INTO macquarie_portal_users (email, display_name, kept) VALUES (?, ?, false)").bind(email, name).run();
    const activityLogged = await note(user, "Added a portal sign-in", `Added portal sign-in ${name} <${email}>`);
    return afterSave(user, activityLogged, "Sign-in added.");
  }
  if (isSeedEmail(email)) return { status: 400, body: { error: "That sign-in is kept by RJL." } };
  const row = await getSql().prepare("SELECT email, kept FROM macquarie_portal_users WHERE lower(email) = ?").bind(email).first<{ kept: unknown }>();
  if (!row) return { status: 400, body: { error: "That sign-in is not on the list." } };
  if (asBool(row.kept)) return { status: 400, body: { error: "That sign-in is kept by RJL." } };
  await getSql().prepare("DELETE FROM macquarie_portal_users WHERE lower(email) = ? AND kept = false").bind(email).run();
  const activityLogged = await note(user, "Removed a portal sign-in", `Removed portal sign-in ${email}`);
  return afterSave(user, activityLogged, "Sign-in removed.");
}

async function changeCaller(user: ResidentSession, loaded: Loaded, body: Record<string, unknown>): Promise<ResidentResult> {
  if (body.action === "caller.add") {
    const input = await queueSliding(user.email, { kind: "user.add", name: body.name, phone: body.phone });
    const activityLogged = await note(user, "Added a gate caller", `Added gate caller ${String(input.args.name)} ${displayPhone(String(input.args.phone))}`);
    return afterSave(user, activityLogged, "Caller added. The sliding gate applies it on its next check-in.");
  }
  const id = localId(body.id);
  if (!id) return { status: 400, body: { error: "Unknown entry." } };
  const caller = loaded.callers.find((row) => row.id === String(id));
  await queueSliding(user.email, { kind: "user.delete", local_id: id });
  const activityLogged = await note(user, "Removed a gate caller", caller ? `Removed gate caller ${caller.name} ${caller.phone}` : "Removed a gate caller");
  return afterSave(user, activityLogged, "Caller removed. The sliding gate applies it on its next check-in.");
}

async function changeHold(user: ResidentSession, loaded: Loaded, body: Record<string, unknown>): Promise<ResidentResult> {
  if (!loaded.slidingId) return refuse(user, "The sliding gate is not linked, so the change was not saved.", NOT_LINKED);
  if (body.action === "hold.now") {
    const window = holdNowWindow(new Date(), body.until);
    if (!window.ok) return { status: 400, body: { error: window.error } };
    await queueSliding(user.email, { kind: "hold.add", name: window.row.name, days: gdDays(window.row.days), open_time: window.row.open_time, close_time: window.row.close_time });
    const activityLogged = await note(user, "Held the gate open", `Held the sliding gate open until ${window.row.close_time}`);
    return afterSave(user, activityLogged, "Hold-open time saved. The sliding gate applies it on its next check-in.");
  }
  if (body.action === "hold.save") {
    const window = plannedHold(body);
    if (!window.ok) return { status: 400, body: { error: window.error } };
    const id = localId(body.id);
    await queueSliding(user.email, {
      kind: id ? "hold.update" : "hold.add",
      ...(id ? { local_id: id } : {}),
      name: window.row.name,
      days: gdDays(window.row.days),
      open_time: window.row.open_time,
      close_time: window.row.close_time,
    });
    const activityLogged = await note(user, "Saved a hold-open window", `Saved hold-open window ${window.row.name} ${window.row.open_time}-${window.row.close_time}`);
    return afterSave(user, activityLogged, "Hold-open window saved. The sliding gate applies it on its next check-in.");
  }
  if (body.action === "hold.end") {
    const id = localId(body.id);
    const targets = id ? loaded.windows.filter((row) => row.id === String(id)) : loaded.windows.filter((row) => windowCoversNow(new Date(), row));
    if (!targets.length) return { status: 400, body: { error: id ? "That window no longer exists." : "No hold-open window is active right now." } };
    for (const row of targets) {
      const targetId = localId(row.id);
      if (targetId) await queueSliding(user.email, { kind: "hold.enable", local_id: targetId, enabled: false });
    }
    const activityLogged = await note(user, "Ended a hold-open window", id ? "Ended a hold-open window" : "Ended the hold-open window that covers now");
    return afterSave(user, activityLogged, "Hold ended. The sliding gate applies it on its next check-in.");
  }
  const id = localId(body.id);
  if (!id) return { status: 400, body: { error: "Unknown entry." } };
  await queueSliding(user.email, { kind: "hold.delete", local_id: id });
  const activityLogged = await note(user, "Removed a hold-open window", "Removed a hold-open window");
  return afterSave(user, activityLogged, "Hold-open window removed. The sliding gate applies it on its next check-in.");
}
