import type { PortalUser } from "./portal-model";

const LOGIN_COOKIE = "__Host-balwyn_google_login";
const LOGIN_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
type LoginStatement = {
  bind(...values: (string | number)[]): LoginStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type LoginDatabase = {
  prepare(sql: string): LoginStatement;
  batch(statements: LoginStatement[]): Promise<unknown>;
};
type GoogleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type GoogleSettings = { clientId: string; allowedEmails: Set<string>; accountRoles?: Map<string, PortalUser["role"]> };
type LoginChallenge = { state_hash: string; browser_hash: string; nonce: string };

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomToken(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

async function hash(value: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function browserToken(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((value) => value.trim()).filter((value) => value.startsWith(`${LOGIN_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(LOGIN_COOKIE.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}

export function isSameOriginSignInRequest(request: Request): boolean {
  const url = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  // Behind a TLS-terminating proxy (Render, Cloudflare) the request reaches this
  // process over plain HTTP, so `url.protocol` is "http:" even though the browser
  // used HTTPS. Trust `x-forwarded-proto`, which Render and Cloudflare overwrite on
  // every inbound request, and fall back to the observed protocol when absent.
  // Still fail-closed: anything that is not HTTPS at the edge is rejected.
  const forwarded = request.headers.get("x-forwarded-proto");
  const protocol = (forwarded ? forwarded.split(",")[0].trim() : url.protocol.replace(":", "")).toLowerCase();
  const origin = `${protocol}://${url.host}`;
  return request.method === "POST" && protocol === "https"
    && request.headers.get("origin") === origin
    && (!fetchSite || fetchSite === "same-origin")
    && request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}

export function clearGoogleSignInCookie(): string {
  return `${LOGIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function createGoogleSignInChallenge(db: LoginDatabase, request: Request) {
  if (!isSameOriginSignInRequest(request)) throw new Error("Sign-in request rejected.");
  const browser = browserToken(request) ?? randomToken();
  const state = randomToken();
  const nonce = randomToken();
  const now = Date.now();
  const expiresAt = now + LOGIN_LIFETIME_MS;
  const [stateHash, browserHash] = await Promise.all([hash(state), hash(browser)]);
  await db.batch([
    db.prepare("DELETE FROM google_login_challenges WHERE state_hash IN (SELECT state_hash FROM google_login_challenges WHERE expires_at <= ? LIMIT 100)").bind(now),
    db.prepare("INSERT INTO google_login_challenges (state_hash, browser_hash, nonce, expires_at) VALUES (?, ?, ?, ?)").bind(stateHash, browserHash, nonce, expiresAt),
  ]);
  return {
    state, nonce, expiresAt,
    cookie: `${LOGIN_COOKIE}=${browser}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${LOGIN_LIFETIME_MS / 1000}`,
  };
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token encoding.");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeObject(value: string): Record<string, unknown> {
  const result: unknown = JSON.parse(new TextDecoder().decode(decode(value)));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid token claims.");
  return result as Record<string, unknown>;
}

async function verifyGoogleIdentity(credential: string, nonce: string, settings: GoogleSettings, fetcher: typeof fetch): Promise<PortalUser | null> {
  const parts = credential.split(".");
  if (parts.length !== 3 || credential.length > 10_000) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = decodeObject(encodedHeader);
    claims = decodeObject(encodedPayload);
    signature = decode(encodedSignature);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const audienceValid = claims.aud === settings.clientId || (Array.isArray(claims.aud)
    && claims.aud.every((value) => typeof value === "string") && claims.aud.includes(settings.clientId));
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || !audienceValid) return null;
  if (claims.azp !== undefined && claims.azp !== settings.clientId) return null;
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== settings.clientId) return null;
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
  if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= now) return null;
  if (typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat > now + 60 || claims.iat <= 0 || claims.exp <= claims.iat) return null;
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return null;
  if (typeof claims.email !== "string" || !claims.email.includes("@") || claims.email_verified !== true) return null;
  if (claims.nonce !== nonce) return null;
  const email = claims.email.trim().toLocaleLowerCase("en-AU");
  if (!settings.allowedEmails.has(email) || (settings.accountRoles && !settings.accountRoles.has(email))) return null;

  const response = await fetcher("https://www.googleapis.com/oauth2/v3/certs", {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Google signing keys are unavailable.");
  const keySet = await response.json() as { keys?: GoogleJwk[] };
  if (!Array.isArray(keySet?.keys)) throw new Error("Google signing keys are unavailable.");
  const jwk = keySet.keys.find((key) => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256" && (!key.use || key.use === "sig"));
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(`${encodedHeader}.${encodedPayload}`));
  if (!validSignature) return null;
  return { displayName: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email, email, role: settings.accountRoles?.get(email) ?? "administrator" };
}

export async function authenticateGoogleSignIn(
  db: LoginDatabase,
  request: Request,
  input: { credential?: unknown; state?: unknown },
  settings: GoogleSettings,
  fetcher: typeof fetch = fetch,
): Promise<PortalUser | null> {
  if (!isSameOriginSignInRequest(request)) return null;
  if (!input || typeof input.credential !== "string" || input.credential.length < 100 || input.credential.length > 10_000) return null;
  if (typeof input.state !== "string" || !TOKEN_PATTERN.test(input.state)) return null;
  const browser = browserToken(request);
  if (!browser) return null;
  const [stateHash, browserHash] = await Promise.all([hash(input.state), hash(browser)]);
  const challenge = await db.prepare("SELECT state_hash, browser_hash, nonce FROM google_login_challenges WHERE state_hash = ? AND browser_hash = ? AND expires_at > ?")
    .bind(stateHash, browserHash, Date.now()).first<LoginChallenge>();
  if (!challenge) return null;
  const user = await verifyGoogleIdentity(input.credential, challenge.nonce, settings, fetcher);
  if (!user) return null;
  // Consume in one database statement. Concurrent copies of a valid response
  // cannot both create a session, even when served by different Workers.
  const consumed = await db.prepare("DELETE FROM google_login_challenges WHERE state_hash = ? AND browser_hash = ? AND nonce = ? AND expires_at > ? RETURNING state_hash")
    .bind(challenge.state_hash, challenge.browser_hash, challenge.nonce, Date.now()).first<{ state_hash: string }>();
  return consumed ? user : null;
}
