import type { PortalUser } from "./portal-model";
import { requestOrigin, requestProtocol } from "./request-origin";

const AUTHORITY = "https://login.microsoftonline.com";
const COOKIE = "__Host-balwyn_microsoft_login";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
type Statement = { bind(...values: (string | number)[]): Statement; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type Database = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> };
type Settings = { clientId: string; clientSecret: string; allowedAccounts: Set<string>; accountRoles?: Map<string, PortalUser["role"]> };
type Challenge = { nonce: string; verifier: string };
type MicrosoftJwk = JsonWebKey & { kid?: string; alg?: string; use?: string; issuer?: string };

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function randomToken(): string { return encode(crypto.getRandomValues(new Uint8Array(32))); }
async function hash(value: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function browserToken(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE.length + 1);
  return TOKEN.test(value) ? value : null;
}
function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  if (url.protocol !== "https:") throw new Error("HTTPS is required.");
  return `${url.origin}/api/auth/microsoft/callback`;
}
export function clearMicrosoftSignInCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createMicrosoftSignInChallenge(db: Database, request: Request, settings: Settings) {
  const url = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.method !== "POST" || requestProtocol(request) !== "https:" || request.headers.get("origin") !== requestOrigin(request)
    || (fetchSite && fetchSite !== "same-origin")) throw new Error("Sign-in request rejected.");
  const state = randomToken();
  const browser = browserToken(request) ?? randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  await db.batch([
    db.prepare("DELETE FROM microsoft_login_challenges WHERE state_hash IN (SELECT state_hash FROM microsoft_login_challenges WHERE expires_at <= ? LIMIT 100)").bind(Date.now()),
    db.prepare("INSERT INTO microsoft_login_challenges (state_hash, browser_hash, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await hash(state), await hash(browser), nonce, verifier, Date.now() + 600_000),
  ]);
  const authorize = new URL(`${AUTHORITY}/common/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({ client_id: settings.clientId, response_type: "code", response_mode: "query",
    redirect_uri: callbackUrl(request), scope: "openid profile email", prompt: "select_account",
    state, nonce, code_challenge: await hash(verifier), code_challenge_method: "S256",
  }).toString();
  return { url: authorize.href, cookie: `${COOKIE}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` };
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token.");
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
}
function decodeObject(value: string): Record<string, unknown> {
  const result: unknown = JSON.parse(new TextDecoder().decode(decode(value)));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid token.");
  return result as Record<string, unknown>;
}

async function verifyIdentity(token: string, nonce: string, settings: Settings, fetcher: typeof fetch) {
  if (token.length > 16_000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try { header = decodeObject(parts[0]); claims = decodeObject(parts[1]); signature = decode(parts[2]); }
  catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || claims.ver !== "2.0"
    || claims.aud !== settings.clientId || claims.nonce !== nonce
    || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255
    || typeof claims.tid !== "string" || !GUID.test(claims.tid)
    || typeof claims.oid !== "string" || !GUID.test(claims.oid)) return null;
  const issuer = `${AUTHORITY}/${claims.tid}/v2.0`;
  if (claims.iss !== issuer || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= now
    || typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat <= 0 || claims.iat > now + 60 || claims.exp <= claims.iat
    || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf) || claims.nbf > now + 60))) return null;
  const subject = `${claims.tid}:${claims.oid}`.toLowerCase();
  // Email and preferred_username are display hints, never proof of approval.
  if (!settings.allowedAccounts.has(subject) || (settings.accountRoles && !settings.accountRoles.has(subject))) return null;
  const keysResponse = await fetcher(`${AUTHORITY}/common/discovery/v2.0/keys`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000), redirect: "error",
  });
  if (!keysResponse.ok) throw new Error("Microsoft signing keys are unavailable.");
  const keySet = await keysResponse.json() as { keys?: MicrosoftJwk[] };
  const jwk = Array.isArray(keySet.keys) ? keySet.keys.find((key) => key.kid === header.kid && key.kty === "RSA"
    && (!key.alg || key.alg === "RS256") && (!key.use || key.use === "sig")
    && typeof key.issuer === "string" && key.issuer.replace("{tenantid}", claims.tid as string) === issuer) : undefined;
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(`${parts[0]}.${parts[1]}`))) return null;
  const emailHint = typeof claims.email === "string" ? claims.email : claims.preferred_username;
  const email = typeof emailHint === "string" && emailHint.length <= 254 && emailHint.includes("@") ? emailHint.trim().toLowerCase() : "Contact email not configured";
  const user: PortalUser = { displayName: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 200) : "Microsoft operator", email, role: settings.accountRoles?.get(subject) ?? "administrator" };
  return { user, subject };
}

export async function authenticateMicrosoftSignIn(db: Database, request: Request, settings: Settings, fetcher: typeof fetch = fetch) {
  const url = new URL(request.url);
  if (request.method !== "GET" || requestProtocol(request) !== "https:" || url.pathname !== "/api/auth/microsoft/callback") return null;
  const state = url.searchParams.get("state");
  const browser = browserToken(request);
  if (!state || !TOKEN.test(state) || !browser || url.searchParams.getAll("state").length !== 1) return null;
  // Single-use across Worker instances, including error and cancelled responses.
  const challenge = await db.prepare(`DELETE FROM microsoft_login_challenges
    WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING nonce, verifier`)
    .bind(await hash(state), await hash(browser), Date.now()).first<Challenge>();
  const code = url.searchParams.get("code");
  if (!challenge || url.searchParams.has("error") || !code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) return null;
  const response = await fetcher(`${AUTHORITY}/common/oauth2/v2.0/token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret,
      grant_type: "authorization_code", code, redirect_uri: callbackUrl(request), code_verifier: challenge.verifier,
      scope: "openid profile email" }),
  });
  if (!response.ok) throw new Error("Microsoft sign-in could not be completed.");
  const tokens = await response.json() as { id_token?: unknown };
  if (typeof tokens.id_token !== "string") return null;
  return verifyIdentity(tokens.id_token, challenge.nonce, settings, fetcher);
}
