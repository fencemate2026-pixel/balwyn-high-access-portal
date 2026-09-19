import { getD1 } from "@/db";
import { microsoftSettings } from "@/lib/auth-settings";
import { createMicrosoftSignInChallenge } from "@/lib/microsoft-signin";
import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { signInRateKey } from "@/lib/portal-auth";
import { reserveSignInAttempt, SignInRateLimitError } from "@/lib/signin-rate-limit";

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "The sign-in request was rejected." }, { status: 403, headers });
  try {
    const settings = microsoftSettings();
    const db = getD1();
    await reserveSignInAttempt(db, await signInRateKey(`microsoft:ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`), 30);
    const { cookie, url } = await createMicrosoftSignInChallenge(db, request, settings);
    headers.append("Set-Cookie", cookie);
    return Response.json({ url }, { headers });
  } catch (error) {
    if (error instanceof SignInRateLimitError) {
      headers.set("Retry-After", "900");
      return Response.json({ error: error.message }, { status: 429, headers });
    }
    return Response.json({ error: "Microsoft sign-in is not available yet. Please use Google or your operator email." }, { status: 503, headers });
  }
}
