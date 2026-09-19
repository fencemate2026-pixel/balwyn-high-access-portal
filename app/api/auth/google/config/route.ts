import { googleClientId } from "@/lib/portal-auth";
import { GOOGLE_SIGN_IN_ORIGIN, GOOGLE_SIGN_IN_URL } from "@/lib/google-signin-origin";

export async function GET() {
  try {
    return Response.json({ clientId: googleClientId(), authorizedJavaScriptOrigin: GOOGLE_SIGN_IN_ORIGIN, loginUrl: GOOGLE_SIGN_IN_URL }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Google sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
