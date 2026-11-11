import { getSql } from "@/db";
import { clientAddress } from "@/lib/client-address";
import { createMfaChallengeCookie, clearMfaChallengeCookie, createSessionCookie, credentialIdentity, getOrCreateTotpEnrollment, recordAccountSignIn, requestFingerprint, signInRateKey, verifyAccountCredentials, verifyOperatorCredentials } from "@/lib/portal-auth";
import { recordActivity, getPortalSnapshot } from "@/lib/portal-store";
import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { reserveSignInAttempts, SignInRateLimitError } from "@/lib/signin-rate-limit";
import { readSignInBody } from "@/lib/signin-request";
import { isSettlementMember } from "@/lib/settlement-access";

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearMfaChallengeCookie());
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "The sign-in request was rejected." }, { status: 403, headers });
  let body: Record<string, unknown>;
  try { body = await readSignInBody(request); }
  catch { return Response.json({ error: "Enter your email and password." }, { status: 400, headers }); }
  if (typeof body.email !== "string" || !body.email.trim() || body.email.length > 254
    || typeof body.password !== "string" || !body.password || body.password.length > 1024) {
    return Response.json({ error: "Enter your email and password." }, { status: 400, headers });
  }
  try {
    // Both rate-limit reservations in one database round trip.
    await reserveSignInAttempts(getSql(), [
      { key: await signInRateKey(`email:ip:${clientAddress(request)}`), limit: 24 },
      { key: await signInRateKey(`email:account:${body.email.trim().toLowerCase()}`) },
    ]);
    // Site accounts (Render/Azure settings) win over per-person accounts; both
    // are checked at the same time so their database lookups overlap.
    const [siteUser, accountUser] = await Promise.all([
      verifyOperatorCredentials(body.email, body.password),
      verifyAccountCredentials(body.email, body.password),
    ]);
    const user = siteUser ?? accountUser;
    if (!user) return Response.json({ error: "The email or password was not recognised. Use an approved operator account." }, { status: 401, headers });
    // Settlement Road members never receive the operations snapshot. They sign in to that site only.
    if (user.isOwner !== true && isSettlementMember(user.email)) {
      const identity = await credentialIdentity(user);
      if (!identity) return Response.json({ error: "This account is not available." }, { status: 401, headers });
      headers.append("Set-Cookie", await createSessionCookie(user, identity));
      await recordAccountSignIn(user);
      await recordActivity(user, "Signed in", "Email and password (Settlement Road site)", "access");
      return Response.json({ settlementSite: true }, { headers });
    }
    // View-only per-person accounts sign in with the password alone: they cannot
    // open gates or change anything. Operators and administrators always get the
    // authenticator step below.
    if (user.accountId && user.role === "viewer") {
      const identity = await credentialIdentity(user);
      if (!identity) return Response.json({ error: "This account is not available." }, { status: 401, headers });
      const snapshot = await getPortalSnapshot(user);
      headers.append("Set-Cookie", await createSessionCookie(user, identity));
      await recordAccountSignIn(user);
      await recordActivity(user, "Signed in", "Email and password (view-only account)", "access");
      return Response.json({ snapshot }, { headers });
    }
    const enrollment = await getOrCreateTotpEnrollment(user);
    headers.set("Set-Cookie", await createMfaChallengeCookie(user, await requestFingerprint(request)));
    return Response.json({ requiresAuthenticator: true,
      enrollment: enrollment.enrolled ? null : { secret: enrollment.secret, account: enrollment.account },
    }, { headers });
  } catch (error) {
    if (error instanceof SignInRateLimitError) {
      headers.set("Retry-After", "900");
      return Response.json({ error: error.message }, { status: 429, headers });
    }
    console.error("Email sign-in could not be prepared.");
    return Response.json({ error: "Email sign-in is temporarily unavailable. Try Google or contact your portal administrator." }, { status: 503, headers });
  }
}
