// The person sets their own password from the one-time link an administrator
import { clientAddress } from "@/lib/client-address";
// gave them. Rate limited per address; the link stops working once used.
import { getSql } from "@/db";
import { AccountError, setPasswordWithToken, signInRateKey } from "@/lib/portal-auth";
import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { reserveSignInAttempt, SignInRateLimitError } from "@/lib/signin-rate-limit";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  try {
    await reserveSignInAttempt(getSql(), await signInRateKey(`setup:ip:${clientAddress(request)}`), 12);
    const result = await setPasswordWithToken(String(body.token ?? ""), String(body.password ?? ""));
    return Response.json({ email: result.email }, { headers });
  } catch (error) {
    if (error instanceof SignInRateLimitError) return Response.json({ error: error.message }, { status: 429, headers: { ...headers, "Retry-After": "900" } });
    if (error instanceof AccountError) return Response.json({ error: error.message }, { status: 400, headers });
    return Response.json({ error: "The password could not be saved. Try again shortly." }, { status: 503, headers });
  }
}
