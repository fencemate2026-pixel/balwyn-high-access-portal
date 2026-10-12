import { portalEmailAllowed, withOwnerAccess } from "@/lib/owner-access";
import { googleAccountRoles } from "@/lib/auth-settings";
import { getSql } from "@/db";
import { createSessionCookie, googleAllowedEmails, googleClientId } from "@/lib/portal-auth";
import { authenticateGoogleSignIn, clearGoogleSignInCookie, isSameOriginSignInRequest } from "@/lib/google-signin";
import { getPortalSnapshot, recordActivity } from "@/lib/portal-store";

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "The sign-in request was rejected." }, { status: 403, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 12_000) return Response.json({ error: "The sign-in response is too large." }, { status: 413, headers });
  let body: { credential?: unknown; state?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Google did not provide a valid sign-in response." }, { status: 400, headers });
  }
  let stage = "verify_google_identity";
  try {
    const verifiedUser = await authenticateGoogleSignIn(getSql(), request, body, { clientId: googleClientId(), allowedEmails: googleAllowedEmails(), accountRoles: googleAccountRoles() });
    if (!verifiedUser || !portalEmailAllowed(verifiedUser.email)) return Response.json({ error: "This sign-in request has expired or the Google account is not approved. Please try again with an approved account." }, { status: 403, headers });
    const user = withOwnerAccess(verifiedUser, "google");
    // getPortalSnapshot seeds a brand-new portal itself (no extra round trip).
    // The sign-in is written to the permanent activity log in parallel, so the
    // audit trail covers every sign-in method, not only view-only accounts.
    stage = "read_portal_snapshot";
    const [snapshot] = await Promise.all([
      getPortalSnapshot(user),
      recordActivity(user, "Signed in", "Google account", "access"),
    ]);
    stage = "create_session";
    headers.append("Set-Cookie", await createSessionCookie(user));
    headers.append("Set-Cookie", clearGoogleSignInCookie());
    return Response.json({ snapshot }, { headers });
  } catch (error) {
    // Name + message only. Never the credential, the state or the database key.
    console.error("google_signin_failed", {
      stage,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Google sign-in is temporarily unavailable." }, { status: 503, headers });
  }
}
