import { getD1 } from "@/db";
import { microsoftSettings } from "@/lib/auth-settings";
import { authenticateMicrosoftSignIn, clearMicrosoftSignInCookie } from "@/lib/microsoft-signin";
import { createSessionCookie } from "@/lib/portal-auth";
import { ensurePortalSeeded } from "@/lib/portal-store";

export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Location: "/login?signin=microsoft_failed" });
  headers.append("Set-Cookie", clearMicrosoftSignInCookie());
  try {
    const result = await authenticateMicrosoftSignIn(getD1(), request, microsoftSettings());
    if (result) {
      await ensurePortalSeeded();
      headers.append("Set-Cookie", await createSessionCookie(result.user, { provider: "microsoft", subject: result.subject }));
      headers.set("Location", "/login");
    }
  } catch { console.error("Microsoft sign-in could not be completed."); }
  return new Response(null, { status: 303, headers });
}
