import { getD1 } from "@/db";
import { clearMfaChallengeCookie, createSessionCookie, getMfaChallenge, passwordSessionIdentity, requestFingerprint, signInRateKey, verifyAuthenticatorCode } from "@/lib/portal-auth";
import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { ensurePortalSeeded, getPortalSnapshot } from "@/lib/portal-store";
import { reserveSignInAttempt, SignInRateLimitError } from "@/lib/signin-rate-limit";
import { readSignInBody } from "@/lib/signin-request";

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "The sign-in request was rejected." }, { status: 403, headers });
  let body: Record<string, unknown>;
  try { body = await readSignInBody(request); }
  catch { return Response.json({ error: "Enter the six-digit authenticator code." }, { status: 400, headers }); }
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) return Response.json({ error: "Enter the six-digit authenticator code." }, { status: 400, headers });
  try {
    const challenge = await getMfaChallenge(request);
    if (!challenge || challenge.fingerprint !== await requestFingerprint(request)) {
      headers.append("Set-Cookie", clearMfaChallengeCookie());
      return Response.json({ error: "Your sign-in has expired. Enter your email and password again.", restart: true }, { status: 401, headers });
    }
    const identity = await passwordSessionIdentity(challenge.user);
    if (!identity) return Response.json({ error: "This operator account is no longer available.", restart: true }, { status: 401, headers });
    await reserveSignInAttempt(getD1(), await signInRateKey(`email:mfa:${challenge.user.displayName.toLowerCase()}`));
    if (!await verifyAuthenticatorCode(challenge.user, body.code)) return Response.json({ error: "That code was not accepted. Enter the current code from your authenticator." }, { status: 401, headers });
    await ensurePortalSeeded();
    const snapshot = await getPortalSnapshot(challenge.user);
    headers.append("Set-Cookie", await createSessionCookie(challenge.user, identity));
    headers.append("Set-Cookie", clearMfaChallengeCookie());
    return Response.json({ snapshot }, { headers });
  } catch (error) {
    if (error instanceof SignInRateLimitError) {
      headers.set("Retry-After", "900");
      return Response.json({ error: error.message }, { status: 429, headers });
    }
    console.error("Email sign-in verification could not be completed.");
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
