/**
 * TEMPORARY DIAGNOSTIC — DELETE AFTER USE.
 *
 * Reports only what the server computes for protocol, host and origin, plus
 * the forwarded headers that decide it. No cookies, no authorisation header,
 * no secrets. Exists to prove why the same-origin check fails in production
 * instead of guessing at it.
 */
import { requestHost, requestOrigin, requestProtocol } from "@/lib/request-origin";

export async function GET(request: Request) {
  return Response.json({
    requestUrl: request.url,
    computedProtocol: requestProtocol(request),
    computedHost: requestHost(request),
    computedOrigin: requestOrigin(request),
    headers: {
      host: request.headers.get("host"),
      "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
      "x-forwarded-host": request.headers.get("x-forwarded-host"),
      origin: request.headers.get("origin"),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
