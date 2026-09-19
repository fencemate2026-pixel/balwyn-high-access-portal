import { getD1 } from "@/db";
import { googleClientId } from "@/lib/portal-auth";
import { createGoogleSignInChallenge, isSameOriginSignInRequest } from "@/lib/google-signin";

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin, Cookie" });
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "The sign-in request was rejected." }, { status: 403, headers });
  try {
    const clientId = googleClientId();
    const { cookie, ...challenge } = await createGoogleSignInChallenge(getD1(), request);
    headers.append("Set-Cookie", cookie);
    return Response.json({ clientId, ...challenge }, { headers });
  } catch {
    console.error("Google sign-in challenge could not be created.");
    return Response.json({ error: "Google sign-in is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
