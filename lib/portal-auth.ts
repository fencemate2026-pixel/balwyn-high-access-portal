import { env } from "@/lib/server-env";
import { eq } from "drizzle-orm";

import type { PortalUser } from "./portal-model";
import { getDb, getSql } from "@/db";
import { operatorTotp } from "@/db/schema";
import { googleAccountRoles, microsoftAccountRoles } from "./auth-settings";
import { configuredRole } from "./account-roles";
import { portalEmailAllowed, withOwnerAccess } from "./owner-access";
import { requestOrigin, requestProtocol } from "./request-origin.ts";

const COOKIE_NAME = "balwyn_operator_session";
const MFA_COOKIE_NAME = "balwyn_operator_mfa";
const ADMIN_COOKIE_NAME = "__Host-balwyn_admin_settings";
const ADMIN_LIFETIME_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();
const PASSWORD_ITERATIONS_PER_STAGE = 100_000;
const PASSWORD_STAGES = 3;

type RuntimeSecrets = {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionSecret: string;
  operatorEmail: string;
  role: PortalUser["role"];
  secondary: {
    username: string;
    passwordSalt: string;
    passwordHash: string;
    operatorEmail: string;
    role: PortalUser["role"];
    phone: string;
  } | null;
};

type MfaChallenge = {
  user: PortalUser;
  fingerprint: string;
  credentialVersion: string;
  expiresAt: number;
};

function sessionSecret(): string {
  const secret = String(env.PORTAL_SESSION_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("Operator sessions are not configured.");
  return secret;
}

function runtimeSecrets(): RuntimeSecrets {
  const username = String(env.PORTAL_USERNAME ?? "").trim();
  const passwordSalt = String(env.PORTAL_PASSWORD_SALT ?? "").trim();
  const passwordHash = String(env.PORTAL_PASSWORD_HASH ?? "").trim();
  const sessionSecret = String(env.PORTAL_SESSION_SECRET ?? "").trim();
  const operatorEmail = String(env.PORTAL_OPERATOR_EMAIL ?? "").trim();
  const secondaryUsername = String(env.PORTAL_SECONDARY_USERNAME ?? "").trim();
  const secondaryPasswordSalt = String(env.PORTAL_SECONDARY_PASSWORD_SALT ?? "").trim();
  const secondaryPasswordHash = String(env.PORTAL_SECONDARY_PASSWORD_HASH ?? "").trim();
  const secondaryOperatorEmail = String(env.PORTAL_SECONDARY_OPERATOR_EMAIL ?? "").trim();
  const secondaryPhone = String(env.PORTAL_SECONDARY_OPERATOR_PHONE ?? "").trim();
  if (!username || !passwordSalt || !passwordHash || sessionSecret.length < 32) {
    throw new Error("Operator authentication is not configured.");
  }
  const secondary = secondaryUsername && secondaryPasswordSalt && secondaryPasswordHash
    ? { username: secondaryUsername, passwordSalt: secondaryPasswordSalt, passwordHash: secondaryPasswordHash, operatorEmail: secondaryOperatorEmail, phone: secondaryPhone, role: configuredRole(env.PORTAL_SECONDARY_ROLE) }
    : null;
  return { username, passwordSalt, passwordHash, sessionSecret, operatorEmail, secondary, role: configuredRole(env.PORTAL_ROLE) };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function passwordDigest(password: string, salt: string): Promise<string> {
  let material = encoder.encode(password);
  for (let stage = 1; stage <= PASSWORD_STAGES; stage += 1) {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    const stageSalt = stage === 1 ? salt : `${salt}:stage:${stage}`;
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(stageSalt),
        iterations: PASSWORD_ITERATIONS_PER_STAGE,
      },
      key,
      256,
    );
    material = new Uint8Array(bits);
  }
  return base64Url(material);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyOperatorCredentials(username: string, password: string): Promise<PortalUser | null> {
  const configured = runtimeSecrets();
  const suppliedName = username.trim().toLocaleLowerCase("en-AU");
  const accounts = [
    { username: configured.username, passwordSalt: configured.passwordSalt, passwordHash: configured.passwordHash, operatorEmail: configured.operatorEmail, role: configured.role },
    ...(configured.secondary ? [configured.secondary] : []),
  ];
  for (const account of accounts) {
    if (!portalEmailAllowed(account.operatorEmail)) continue;
    const profile = await getSql().prepare("SELECT username FROM user_profiles WHERE account_key = ?")
      .bind(`password:${account.username.toLocaleLowerCase("en-AU")}`).first<{ username: string | null }>();
    const suppliedHash = await passwordDigest(password, account.passwordSalt);
    const validName = suppliedName === account.username.toLocaleLowerCase("en-AU")
      || (Boolean(account.operatorEmail) && suppliedName === account.operatorEmail.toLocaleLowerCase("en-AU"))
      || (Boolean(profile?.username) && suppliedName === profile?.username);
    if (validName && constantTimeEqual(suppliedHash, account.passwordHash)) {
      return withOwnerAccess({ displayName: account.username, email: account.operatorEmail || "Contact email not configured", role: account.role }, "password");
    }
  }
  return null;
}

export type SessionIdentity = { provider: "google" | "password" | "microsoft"; subject?: string };

export function passwordSignInAvailable(): boolean {
  try { runtimeSecrets(); return true; } catch { return false; }
}

export async function passwordSessionIdentity(user: PortalUser): Promise<SessionIdentity | null> {
  const configured = runtimeSecrets();
  const accounts = [configured, ...(configured.secondary ? [configured.secondary] : [])];
  const account = accounts.find((value) => value.username === user.displayName
    && (value.operatorEmail || "Contact email not configured") === user.email);
  if (!account || account.role !== user.role || !portalEmailAllowed(user.email)) return null;
  return { provider: "password", subject: await hmac(`${account.username}\n${account.passwordHash}`, sessionSecret()) };
}

export async function createSessionCookie(user: PortalUser, identity: SessionIdentity = { provider: "google" }): Promise<string> {
  const secret = sessionSecret();
  const payload = base64Url(encoder.encode(JSON.stringify({
    user,
    identity,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    nonce: crypto.randomUUID(),
  })));
  const signature = await hmac(payload, secret);
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function createMfaChallengeCookie(user: PortalUser, fingerprint: string): Promise<string> {
  const configured = runtimeSecrets();
  const identity = await passwordSessionIdentity(user);
  if (!identity?.subject) throw new Error("Operator account unavailable.");
  const payload = base64Url(encoder.encode(JSON.stringify({
    user,
    fingerprint,
    credentialVersion: identity.subject,
    expiresAt: Date.now() + 10 * 60 * 1000,
  })));
  const signature = await hmac(payload, configured.sessionSecret);
  return `${MFA_COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600`;
}

export function clearMfaChallengeCookie(): string {
  return `${MFA_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function getMfaChallenge(request: Request): Promise<MfaChallenge | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const matches = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${MFA_COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const parts = matches[0].slice(MFA_COOKIE_NAME.length + 1).split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  try {
    const configured = runtimeSecrets();
    if (!constantTimeEqual(signature, await hmac(payload, configured.sessionSecret))) return null;
    const challenge = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as MfaChallenge;
    if (!challenge.user?.displayName || !["administrator", "operator", "viewer"].includes(challenge.user.role) || !challenge.fingerprint
      || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Date.now()) return null;
    if (challenge.credentialVersion !== (await passwordSessionIdentity(challenge.user))?.subject) return null;
    challenge.user = withOwnerAccess(challenge.user, "password");
    return challenge;
  } catch {
    return null;
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function decodeBase32(value: string): Uint8Array<ArrayBuffer> {
  let bits = "";
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid authenticator secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Uint8Array.from(bytes);
}

async function totpEncryptionKey(): Promise<CryptoKey> {
  const configured = runtimeSecrets();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`balwyn-totp:${configured.sessionSecret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptTotpSecret(secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await totpEncryptionKey(), encoder.encode(secret)));
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

async function decryptTotpSecret(value: string): Promise<string> {
  const [encodedIv, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedCiphertext) throw new Error("Authenticator enrollment is invalid.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(encodedIv) }, await totpEncryptionKey(), decodeBase64Url(encodedCiphertext));
  return new TextDecoder().decode(plaintext);
}

function totpAccount(user: PortalUser): string {
  return user.email && !user.email.startsWith("Contact ") ? user.email : user.displayName;
}

export async function getOrCreateTotpEnrollment(user: PortalUser) {
  const db = getDb();
  const username = user.displayName.toLocaleLowerCase("en-AU");
  let [record] = await db.select().from(operatorTotp).where(eq(operatorTotp.username, username)).limit(1);
  if (!record) {
    const secret = randomTotpSecret();
    await db.insert(operatorTotp).values({ username, encryptedSecret: await encryptTotpSecret(secret) }).onConflictDoNothing();
    [record] = await db.select().from(operatorTotp).where(eq(operatorTotp.username, username)).limit(1);
  }
  if (!record) throw new Error("Authenticator enrollment could not be created.");
  const secret = await decryptTotpSecret(record.encryptedSecret);
  const account = totpAccount(user);
  const issuer = "Magic Keys - Balwyn High School";
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { enrolled: Boolean(record.enrolledAt), secret, account, uri };
}

async function hotp(secret: string, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const key = await crypto.subtle.importKey("raw", decodeBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function verifyAuthenticatorCode(user: PortalUser, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const db = getDb();
  const username = user.displayName.toLocaleLowerCase("en-AU");
  const [record] = await db.select().from(operatorTotp).where(eq(operatorTotp.username, username)).limit(1);
  if (!record) return false;
  const secret = await decryptTotpSecret(record.encryptedSecret);
  const currentCounter = Math.floor(Date.now() / 30_000);
  for (const counter of [currentCounter - 1, currentCounter, currentCounter + 1]) {
    if (counter <= record.lastUsedCounter) continue;
    if (constantTimeEqual(await hotp(secret, counter), code)) {
      const consumed = await getSql().prepare(`UPDATE operator_totp SET last_used_counter = ?,
        enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE username = ? AND last_used_counter < ? RETURNING username`)
        .bind(counter, username, counter).first<{ username: string }>();
      return Boolean(consumed);
    }
  }
  return false;
}

export function googleClientId(): string {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  if (!clientId.endsWith(".apps.googleusercontent.com")) throw new Error("Google sign-in is not configured.");
  return clientId;
}

export function googleAllowedEmails(): Set<string> {
  return new Set(googleAccountRoles().keys());
}

export async function getSessionUser(request: Request): Promise<PortalUser | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const matches = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const parts = matches[0].slice(COOKIE_NAME.length + 1).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  try {
    const expected = await hmac(payload, sessionSecret());
    if (!constantTimeEqual(signature, expected)) return null;
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as {
      user?: PortalUser;
      expiresAt?: number;
      identity?: SessionIdentity;
    };
    if (!parsed.user || typeof parsed.expiresAt !== "number" || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null;
    if (typeof parsed.user.displayName !== "string" || !parsed.user.displayName.trim() || !["administrator", "operator", "viewer"].includes(parsed.user.role)) return null;
    // Recheck the configured provider's approval on every authenticated request.
    if (typeof parsed.user.email !== "string" || !portalEmailAllowed(parsed.user.email)) return null;
    const identity = parsed.identity ?? { provider: "google" };
    if (identity.provider === "password") {
      const current = await passwordSessionIdentity(parsed.user);
      if (!current?.subject || current.subject !== identity.subject) return null;
    } else if (identity.provider === "microsoft") {
      if (!identity.subject || microsoftAccountRoles().get(identity.subject) !== parsed.user.role) return null;
    } else if (identity.provider === "google") {
      if (googleAccountRoles().get(parsed.user.email.trim().toLocaleLowerCase("en-AU")) !== parsed.user.role) return null;
    } else return null;
    return withOwnerAccess(parsed.user, identity.provider);
  } catch {
    return null;
  }
}

export async function requireOperator(request: Request, minimum: "viewer" | "operator" | "administrator" = "viewer") {
  const user = await getSessionUser(request);
  if (!user) return { user: null, response: Response.json({ error: "Your secure session has expired. Sign in again." }, { status: 401 }) };
  const rank = { viewer: 0, operator: 1, administrator: 2 } as const;
  if (rank[user.role] < rank[minimum]) {
    return { user: null, response: Response.json({ error: "Your operator role does not allow this action." }, { status: 403 }) };
  }
  return { user, response: null };
}

export async function requestFingerprint(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  return hmac(`${address}\n${agent}`, sessionSecret());
}

export async function signInRateKey(value: string): Promise<string> {
  return hmac(`signin-rate:${value}`, sessionSecret());
}

function administratorPasswords(): { passwordSalt: string; passwordHash: string }[] {
  const passwordSalt = String(env.PORTAL_SETTINGS_PASSWORD_SALT ?? "").trim();
  const passwordHash = String(env.PORTAL_SETTINGS_PASSWORD_HASH ?? "").trim();
  if (passwordSalt || passwordHash) {
    if (!passwordSalt || !passwordHash) throw new Error("Administrator password is not configured.");
    return [{ passwordSalt, passwordHash }];
  }
  const configured = runtimeSecrets();
  return [configured, ...(configured.secondary ? [configured.secondary] : [])].filter(account => account.role === "administrator");
}

export async function verifyAdministratorPassword(password: string): Promise<boolean> {
  if (!password || password.length > 1024) return false;
  for (const account of administratorPasswords()) {
    if (constantTimeEqual(await passwordDigest(password, account.passwordSalt), account.passwordHash)) return true;
  }
  return false;
}

async function adminCredentialVersion() {
  return hmac(JSON.stringify(administratorPasswords().map(({ passwordHash, passwordSalt }) => ({ passwordHash, passwordSalt }))), sessionSecret());
}

function readUniqueCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export async function getSessionAccountKey(request: Request): Promise<string | null> {
  const user = await getSessionUser(request);
  const raw = readUniqueCookie(request, COOKIE_NAME);
  if (!user || !raw) return null;
  const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(raw.split(".")[0]))) as { identity?: SessionIdentity };
  if (value.identity?.provider === "microsoft") return `microsoft:${value.identity.subject}`;
  if (value.identity?.provider === "password") return `password:${user.displayName.toLocaleLowerCase("en-AU")}`;
  return `google:${user.email.trim().toLocaleLowerCase("en-AU")}`;
}

export function clearAdminSettingsCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function createAdminSettingsCookie(request: Request) {
  const user = await getSessionUser(request);
  const session = readUniqueCookie(request, COOKIE_NAME);
  if (user?.role !== "administrator" || !session) throw new Error("Administrator sign-in required.");
  const expiresAt = Date.now() + ADMIN_LIFETIME_MS;
  const payload = base64Url(encoder.encode(JSON.stringify({
    session: await hmac(session, sessionSecret()), expiresAt,
    credentialVersion: await adminCredentialVersion(), nonce: crypto.randomUUID(),
  })));
  return { expiresAt, cookie: `${ADMIN_COOKIE_NAME}=${payload}.${await hmac(payload, sessionSecret())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_LIFETIME_MS / 1000}` };
}

export async function getAdminSettingsAccess(request: Request): Promise<{ expiresAt: number } | null> {
  const user = await getSessionUser(request);
  if (user?.role !== "administrator") return null;
  const token = readUniqueCookie(request, ADMIN_COOKIE_NAME);
  const session = readUniqueCookie(request, COOKIE_NAME);
  if (!token || !session) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!constantTimeEqual(parts[1], await hmac(parts[0], sessionSecret()))) return null;
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as { session?: string; expiresAt?: number; credentialVersion?: string };
    if (typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()
      || value.expiresAt > Date.now() + ADMIN_LIFETIME_MS || value.session !== await hmac(session, sessionSecret())
      || value.credentialVersion !== await adminCredentialVersion()) return null;
    return { expiresAt: value.expiresAt };
  } catch { return null; }
}

export function assertSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  return request.method === "POST" && requestProtocol(request) === "https:" && origin === requestOrigin(request);
}
