/**
 * Public protocol, host and origin for an incoming request.
 *
 * WHY THIS EXISTS
 * Next.js under Node builds `request.url` from the socket the server listens
 * on. Behind a TLS-terminating proxy — Render, Cloudflare, nginx — that socket
 * is plain HTTP on an internal port, and depending on the Next version the URL
 * may also carry an internal host. So HTTPS-only and same-origin checks that
 * read `request.url` directly fail closed, permanently, in production.
 *
 * On Cloudflare Workers `request.url` IS the public URL and no forwarded
 * headers are present, so every fallback below preserves the original
 * behaviour exactly. This is additive, not a relaxation.
 *
 * SECURITY BOUNDARY
 * x-forwarded-proto, x-forwarded-host and host are only trustworthy when a
 * proxy under our control overwrites client-supplied values. Render and
 * Cloudflare both do. If this app is ever exposed directly to the internet
 * with no proxy in front, these headers become attacker-controlled and these
 * checks stop protecting anything. The app must always sit behind the proxy.
 */

/** First value of a possibly comma-joined forwarded header. */
function firstValue(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.split(",")[0].trim().toLowerCase();
  return value || null;
}

export function requestProtocol(request: Request): string {
  const forwarded = firstValue(request.headers.get("x-forwarded-proto"));
  if (forwarded === "https" || forwarded === "http") return `${forwarded}:`;
  return new URL(request.url).protocol;
}

/** Public hostname[:port]. Rejects anything that is not a bare host. */
export function requestHost(request: Request): string {
  for (const candidate of [
    firstValue(request.headers.get("x-forwarded-host")),
    firstValue(request.headers.get("host")),
  ]) {
    if (candidate && /^[a-z0-9.-]+(:\d{1,5})?$/.test(candidate)) return candidate;
  }
  return new URL(request.url).host;
}

export function requestOrigin(request: Request): string {
  return `${requestProtocol(request)}//${requestHost(request)}`;
}
