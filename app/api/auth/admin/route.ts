import { getSql } from "@/db";
import { clientAddress } from "@/lib/client-address";
import { clearAdminSettingsCookie, createAdminSettingsCookie, getAdminSettingsAccess, requireOperator, signInRateKey, verifyAdministratorPassword } from "@/lib/portal-auth";
import { isSameOriginSignInRequest } from "@/lib/google-signin";
import { readSignInBody } from "@/lib/signin-request";
import { reserveSignInAttempt, SignInRateLimitError } from "@/lib/signin-rate-limit";

export async function GET(request: Request) {
  const auth = await requireOperator(request, "administrator");
  if (!auth.user) return auth.response;
  const access = await getAdminSettingsAccess(request);
  return Response.json({ unlocked: Boolean(access), expiresAt: access?.expiresAt ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!isSameOriginSignInRequest(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const auth = await requireOperator(request, "administrator");
  if (!auth.user) return auth.response;
  let body: Record<string, unknown>;
  try { body = await readSignInBody(request); }
  catch { return Response.json({ error: "Enter the administrator password." }, { status: 400, headers }); }
  if (body.action === "lock") {
    headers.append("Set-Cookie", clearAdminSettingsCookie());
    return Response.json({ unlocked: false, expiresAt: null }, { headers });
  }
  if (typeof body.password !== "string" || !body.password || body.password.length > 1024) return Response.json({ error: "Enter the administrator password." }, { status: 400, headers });
  try {
    await reserveSignInAttempt(getSql(), await signInRateKey(`admin:ip:${clientAddress(request)}`), 16);
    await reserveSignInAttempt(getSql(), await signInRateKey(`admin:account:${auth.user.email}:${auth.user.displayName}`));
    if (!await verifyAdministratorPassword(body.password)) return Response.json({ error: "The administrator password was not accepted." }, { status: 403, headers });
    const { cookie, expiresAt } = await createAdminSettingsCookie(request);
    await getSql().prepare("INSERT INTO activity_log (action, detail, category, actor_name, actor_role) VALUES ('Administrator settings unlocked', 'Password verified. Configuration access expires after 10 minutes.', 'security', ?, ?)").bind(auth.user.displayName, auth.user.role).run();
    headers.append("Set-Cookie", cookie);
    return Response.json({ unlocked: true, expiresAt }, { headers });
  } catch (error) {
    if (error instanceof SignInRateLimitError) {
      headers.set("Retry-After", "900");
      return Response.json({ error: error.message }, { status: 429, headers });
    }
    console.error("Administrator settings could not be unlocked.");
    return Response.json({ error: "Administrator verification is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
