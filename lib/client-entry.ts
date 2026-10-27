import { requestOrigin, requestProtocol } from "./request-origin.ts";

type SignInHandler = (request: Request) => Promise<Response>;
const marketingOrigins = new Set(["https://www.magickeys.com.au", "https://magickeys.com.au"]);
const action = "/api/auth/client-entry";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function page(content: string, status = 200, upstream?: Response) {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  for (const cookie of upstream?.headers.getSetCookie() ?? []) headers.append("Set-Cookie", cookie);
  if (upstream?.headers.has("Retry-After")) headers.set("Retry-After", upstream.headers.get("Retry-After")!);
  return new Response(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MagicKeys | Verify your sign-in</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;background:#0a263e;display:grid;place-items:center;padding:24px;font:16px/1.6 system-ui,sans-serif;color:#17344c}main{width:100%;max-width:470px;background:white;border-radius:18px;padding:36px;box-shadow:0 20px 60px #0004}img{width:160px;height:auto;margin-bottom:20px}h1{font-size:28px;line-height:1.2}label{display:block;font-weight:650;margin:22px 0 8px}input{width:100%;font:inherit;font-size:24px;letter-spacing:.25em;padding:13px;border:1px solid #8da9bc;border-radius:8px}input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #1284cf;outline-offset:3px}button{width:100%;margin:20px 0 14px;background:#ff8a3d;color:#102e45;border:0;border-radius:8px;padding:14px;font:inherit;font-weight:700;cursor:pointer}a{color:#08649f}code{display:block;overflow-wrap:anywhere;background:#eef5fa;padding:12px;user-select:all}.error{color:#a02020;background:#fff1ee;padding:12px;border-radius:8px}.note{font-size:14px;color:#526d81}</style></head><body><main><img src="/magic-keys-logo.png" alt="MagicKeys">${content}</main></body></html>`, { status, headers });
}

function verifyPage(error = "", enrollment?: { secret: string; account: string }, upstream?: Response) {
  const setup = enrollment ? `<section><h2>Set up your authenticator</h2><p>Add a time-based account in your authenticator app using this key:</p><code>${escape(enrollment.secret)}</code><p class="note">Account: ${escape(enrollment.account)}</p></section>` : "";
  return page(`<h1>Verify your sign-in</h1><p>Enter the six-digit code from your authenticator app.</p>${setup}${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}<form method="post" action="${action}"><input type="hidden" name="step" value="verify"><label for="code">Authenticator code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus placeholder="000000"><button type="submit">Verify and sign in</button></form><a href="/client-login">Back to sign in</a><p class="note">Approved MagicKeys accounts only.</p>`, error ? upstream?.status ?? 400 : 200, upstream);
}

async function readForm(request: Request) {
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > 8192) throw new Error("Invalid form.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error("Invalid form."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

/** First-party HTML entry. Existing JSON endpoints keep their same-origin guards.
 * Only our two marketing origins may start a cross-origin password sign-in.
 * MFA verification must come from the portal itself with its existing cookie.
 * The internal request carries the same IP/UA/cookies for the original rate
 * limits, credential checks and browser-bound MFA fingerprint.
 */
export function createClientEntryHandler(emailSignIn: SignInHandler, verifySignIn: SignInHandler) {
  return async function POST(request: Request) {
    const origin = requestOrigin(request);
    const source = request.headers.get("origin");
    if (request.method !== "POST" || requestProtocol(request) !== "https:" || !source
      || (!marketingOrigins.has(source) && source !== origin)
      || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
      return page('<h1>Sign-in request rejected</h1><p>Open the MagicKeys login page and try again.</p><a href="/client-login">Back to sign in</a>', 403);
    }
    let form: URLSearchParams;
    try { form = await readForm(request); }
    catch { return page('<h1>Sign-in could not be read</h1><a href="/client-login">Try again</a>', 400); }
    const verify = form.get("step") === "verify";
    if (verify && source !== origin) return page('<h1>Verification request rejected</h1><a href="/client-login">Back to sign in</a>', 403);
    const body = verify ? { code: form.get("code") } : { email: form.get("username"), password: form.get("password") };
    const headers = new Headers(request.headers);
    // Internal dispatch, after the exact origin checks above. No remote proxy,
    // credentials in URLs, token handoff, or replacement authentication logic.
    headers.set("origin", origin);
    headers.set("sec-fetch-site", "same-origin");
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    try {
      const upstream = await (verify ? verifySignIn : emailSignIn)(new Request(new URL(verify ? "/api/auth/email/verify" : "/api/auth/email", origin), { method: "POST", headers, body: JSON.stringify(body) }));
      const result = await upstream.json() as { snapshot?: unknown; requiresAuthenticator?: boolean; enrollment?: { secret: string; account: string } | null; error?: string; restart?: boolean };
      if (upstream.ok && result.snapshot) {
        const redirectHeaders = new Headers({ Location: "/client-login", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        for (const cookie of upstream.headers.getSetCookie()) redirectHeaders.append("Set-Cookie", cookie);
        return new Response(null, { status: 303, headers: redirectHeaders });
      }
      if (upstream.ok && result.requiresAuthenticator) return verifyPage("", result.enrollment ?? undefined, upstream);
      const message = result.error || "Sign-in could not be completed. Please try again.";
      if (verify && !result.restart) return verifyPage(message, undefined, upstream);
      return page(`<h1>Unable to sign in</h1><p class="error" role="alert">${escape(message)}</p><a href="/client-login">Try again</a>`, upstream.ok ? 400 : upstream.status, upstream);
    } catch {
      return page('<h1>Sign-in is temporarily unavailable</h1><p>Please try again in a moment.</p><a href="/client-login">Back to sign in</a>', 503);
    }
  };
}
