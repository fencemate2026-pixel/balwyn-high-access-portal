/**
 * Resident session for Macquarie Drive Thomastown.
 * Same server secret as the operator portal, different cookie and HMAC context,
 * so an operator cookie cannot be replayed here and a resident cookie cannot
 * call /api/portal.
 */
import { env } from "./server-env.ts";

const COOKIE_NAME = "macquarie_resident_session";
const SIGNING_CONTEXT = "macquarie-resident\n";
const LIFETIME_MS = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();

export type ResidentSession = {
  email: string;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
};

export function macquarieSessionSecret(): string {
  const secret = String(env.PORTAL_SESSION_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("Resident sessions are not configured.");
  return secret;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function readUniqueCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export async function createResidentCookie(email: string, displayName: string): Promise<string> {
  const now = Date.now();
  const payload = base64Url(encoder.encode(JSON.stringify({
    email,
    displayName,
    issuedAt: now,
    expiresAt: now + LIFETIME_MS,
    nonce: crypto.randomUUID(),
  })));
  const signature = await hmac(`${SIGNING_CONTEXT}${payload}`, macquarieSessionSecret());
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${LIFETIME_MS / 1000}`;
}

export function clearResidentCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function readResidentSession(request: Request): Promise<ResidentSession | null> {
  const token = readUniqueCookie(request, COOKIE_NAME);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!constantTimeEqual(parts[1], await hmac(`${SIGNING_CONTEXT}${parts[0]}`, macquarieSessionSecret()))) return null;
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as Partial<ResidentSession>;
    if (typeof value.email !== "string" || typeof value.displayName !== "string") return null;
    if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) return null;
    if (value.expiresAt! <= Date.now() || value.expiresAt! > Date.now() + LIFETIME_MS) return null;
    if (value.displayName.length < 1 || value.displayName.length > 80) return null;
    return { email: value.email, displayName: value.displayName, issuedAt: value.issuedAt!, expiresAt: value.expiresAt! };
  } catch {
    return null;
  }
}
