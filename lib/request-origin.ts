/**
 * Public protocol and origin for an incoming request.
 *
 * WHY THIS EXISTS
 * Next.js running under Node builds `request.url` from the socket the server
 * is actually listening on. Behind a TLS-terminating proxy — Render,
 * Cloudflare, nginx, almost any load balancer — that socket is plain HTTP on
 * an internal port. So `request.url` reports "http:" no matter what the
 * browser used. Every HTTPS-only or same-origin check that reads
 * `request.url` directly therefore fails closed, permanently, in production.
 *
 * On Cloudflare Workers `request.url` IS the public URL and no forwarded
 * header is present, so the fallback path below preserves the original
 * behaviour byte for byte. This is additive, not a relaxation.
 *
 * SECURITY BOUNDARY
 * `x-forwarded-proto` is only trustworthy when a proxy under our control
 * overwrites any client-supplied value. Render and Cloudflare both do. If
 * this app is ever exposed directly to the internet with no proxy in front,
 * the header becomes attacker-controlled and these checks weaken to nothing.
 * The app must always sit behind the proxy.
 *
 * Only "http" and "https" are accepted; anything else falls back to the
 * socket protocol rather than being echoed into an origin string.
 */
export function requestProtocol(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim().toLowerCase();
    if (first === "https" || first === "http") return `${first}:`;
  }
  return new URL(request.url).protocol;
}

/** Same-origin comparison target: public protocol + the host from request.url. */
export function requestOrigin(request: Request): string {
  return `${requestProtocol(request)}//${new URL(request.url).host}`;
}
