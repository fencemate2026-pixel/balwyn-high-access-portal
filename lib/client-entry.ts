/** The public MagicKeys form hands credentials straight to the owning portal.
 * No credentials, account names, enrollment secrets or sessions enter a URL.
 * This adapter is intentionally limited to this portal's approved accounts;
 * additional workspaces require an explicit trusted account-routing directory.
 */
const PORTAL = "https://magickeys-balwyn-portal.com";
const MARKETING = "https://www.magickeys.com.au/client-login/";
const ALLOWED_ORIGINS = new Set(["https://www.magickeys.com.au", "https://magickeys.com.au", PORTAL]);
type PasswordHandler = (request: Request) => Promise<Response>;

function redirect(destination: string, source?: Headers): Response {
  const headers = new Headers({ Location: destination, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const cookie of source?.getSetCookie() ?? []) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

async function readCredentials(request: Request) {
  const length = request.headers.get("content-length");
  if (!request.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192))) throw new Error("Invalid request.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error("Invalid request."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const fields = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (fields.getAll("username").length !== 1 || fields.getAll("password").length !== 1) throw new Error("Invalid request.");
  const email = fields.get("username")!.trim();
  const password = fields.get("password")!;
  if (!email || email.length > 254 || !password || password.length > 1024) throw new Error("Invalid request.");
  return { email, password };
}

export async function clientEntry(request: Request, passwordHandler: PasswordHandler, publicOrigin: string): Promise<Response> {
  const origin = request.headers.get("origin");
  const mode = request.headers.get("sec-fetch-mode");
  const destination = request.headers.get("sec-fetch-dest");
  // Explicit origin checks prevent login CSRF. Do not enable wildcard CORS or
  // relax the existing JSON auth endpoint's same-origin checks.
  if (request.method !== "POST" || publicOrigin !== PORTAL || !origin || !ALLOWED_ORIGINS.has(origin)
    || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded"
    || (mode && mode !== "navigate") || (destination && destination !== "document")) {
    return new Response("Sign-in request rejected.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  let credentials;
  try { credentials = await readCredentials(request); }
  catch { return redirect(`${MARKETING}?signin=failed`); }
  try {
    // Only after the external form is checked, adapt it to the unchanged local
    // password handler. Preserve user-agent/IP for rate limits and MFA binding.
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete("cookie"); // A fresh password entry cannot borrow an existing session.
    headers.set("content-type", "application/json");
    headers.set("origin", PORTAL);
    headers.set("host", new URL(PORTAL).host);
    headers.set("x-forwarded-host", new URL(PORTAL).host);
    headers.set("x-forwarded-proto", "https");
    headers.set("sec-fetch-site", "same-origin");
    const result = await passwordHandler(new Request(`${PORTAL}/api/auth/email`, {
      method: "POST", headers, body: JSON.stringify(credentials),
    }));
    if (!result.ok) {
      const state = result.status === 429 ? "retry" : result.status >= 500 ? "unavailable" : "failed";
      return redirect(`${MARKETING}?signin=${state}`, result.headers);
    }
    const body = await result.json() as { requiresAuthenticator?: boolean; snapshot?: unknown };
    if (body.requiresAuthenticator === true) return redirect(`${PORTAL}/login?signin=client-mfa`, result.headers);
    if (body.snapshot) return redirect(`${PORTAL}/login`, result.headers);
    return redirect(`${MARKETING}?signin=unavailable`);
  } catch {
    // Never include provider errors or submitted credentials in logs or URLs.
    return redirect(`${MARKETING}?signin=unavailable`);
  }
}
