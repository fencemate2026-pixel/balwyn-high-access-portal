import { assertSameOrigin, clearAdminSettingsCookie, clearMfaChallengeCookie, clearSessionCookie } from "@/lib/portal-auth";
import { clearGoogleSignInCookie } from "@/lib/google-signin";
import { clearMicrosoftSignInCookie } from "@/lib/microsoft-signin";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearSessionCookie());
  headers.append("Set-Cookie", clearAdminSettingsCookie());
  headers.append("Set-Cookie", clearMfaChallengeCookie());
  headers.append("Set-Cookie", clearGoogleSignInCookie());
  headers.append("Set-Cookie", clearMicrosoftSignInCookie());
  return Response.json({ ok: true }, { headers });
}
