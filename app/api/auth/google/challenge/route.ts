import { getSql } from "@/db";
import { googleClientId } from "@/lib/portal-auth";
import { createGoogleSignInChallenge, isSameOriginSignInRequest } from "@/lib/google-signin";

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin, Cookie" });
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "The sign-in request was rejected." }, { status: 403, headers });
  try {
    const clientId = googleClientId();
    const { cookie, ...challenge } = await createGoogleSignInChallenge(getSql(), request);
    headers.append("Set-Cookie", cookie);
    return Response.json({ clientId, ...challenge }, { headers });
  } catch (error) {
    // Log configuration presence and known error categories, never secret values,
    // request headers, cookies, tokens, or raw upstream error messages.
    const message = error instanceof Error ? error.message : "";
    const databaseStatus = /^Portal database unavailable \((\d{3})\)\.$/.exec(message)?.[1];
    const reason = databaseStatus ? `database_http_${databaseStatus}`
      : message === "Invalid URL" ? "database_url_invalid"
      : message === "Server database configuration is unavailable." ? "database_config_missing"
      : message === "Google sign-in is not configured." ? "google_client_missing"
      : message === "fetch failed" ? "database_network_failure"
      : message === "Invalid database response." ? "database_response_invalid"
      : error instanceof Error && error.name === "TimeoutError" ? "database_timeout"
      : "challenge_failed";
    console.error("google_signin_challenge_failed", {
      reason,
      databaseUrlConfigured: Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_DATABASE_URL),
      databaseKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      sessionSecretConfigured: (process.env.PORTAL_SESSION_SECRET?.trim().length ?? 0) >= 32,
    });
    return Response.json({ error: "Google sign-in is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
