import { readAzureIdentity } from "@/lib/azure-auth";
import { resolveAzureUser } from "@/lib/azure-signin";
import { createSessionCookie, recordAccountSignIn } from "@/lib/portal-auth";
import { ensurePortalSeeded, recordActivity } from "@/lib/portal-store";
import { withOwnerAccess } from "@/lib/owner-access";

/**
 * Landing point after Azure has signed the person in (the login buttons use
 * /.auth/login/<provider>?post_login_redirect_uri=/api/auth/azure/complete).
 * Reads Azure's identity headers, checks approval against the portal's own
 * lists, and starts the portal session. Denials log a reason code only, never
 * an email, token or header.
 */
export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Location: "/login?signin=azure_failed" });
  try {
    const azure = readAzureIdentity(request.headers);
    if ("denied" in azure) {
      console.error("azure_signin_denied", { reason: azure.denied });
    } else {
      const result = await resolveAzureUser(azure.identity);
      if ("denied" in result) {
        console.error("azure_signin_denied", { reason: result.denied, idp: azure.identity.idp });
      } else {
        const user = withOwnerAccess(result.user, result.identity.provider);
        await ensurePortalSeeded();
        await recordActivity(user, "Signed in", result.method, "access");
        if (user.accountId) await recordAccountSignIn(user);
        headers.append("Set-Cookie", await createSessionCookie(user, result.identity));
        headers.set("Location", "/login");
      }
    }
  } catch { console.error("azure_signin_failed"); }
  return new Response(null, { status: 303, headers });
}
