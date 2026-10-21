import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { getMfaChallenge, getOrCreateTotpEnrollment, requestFingerprint } from "@/lib/portal-auth";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "Sign-in request rejected." }, { status: 403, headers });
  try {
    const challenge = await getMfaChallenge(request);
    if (!challenge || challenge.fingerprint !== await requestFingerprint(request)) {
      return Response.json({ error: "Your sign-in has expired. Enter your username and password again.", restart: true }, { status: 401, headers });
    }
    const enrollment = await getOrCreateTotpEnrollment(challenge.user);
    return Response.json({ requiresAuthenticator: true,
      enrollment: enrollment.enrolled ? null : { secret: enrollment.secret, account: enrollment.account },
    }, { headers });
  } catch {
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
