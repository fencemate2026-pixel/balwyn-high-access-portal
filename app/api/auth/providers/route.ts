import { googleClientId, passwordSignInAvailable } from "@/lib/portal-auth";
import { microsoftSettings } from "@/lib/auth-settings";

export async function GET() {
  let google = false;
  let microsoft = false;
  try { googleClientId(); google = true; } catch { /* Provider not connected. */ }
  try { microsoftSettings(); microsoft = true; } catch { /* Provider not connected. */ }
  return Response.json({ google, microsoft, email: passwordSignInAvailable() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
