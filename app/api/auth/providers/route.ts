import { emailSignInAvailable, googleClientId } from "@/lib/portal-auth";
import { microsoftSettings } from "@/lib/auth-settings";
import { azureSignInEnabled } from "@/lib/azure-auth";
import { azureStaffProviderName } from "@/lib/azure-signin";

export async function GET() {
  let google = false;
  let microsoft = false;
  try { googleClientId(); google = true; } catch { /* Provider not connected. */ }
  try { microsoftSettings(); microsoft = true; } catch { /* Provider not connected. */ }
  const azure = azureSignInEnabled();
  // The provider name is a public URL segment, not a secret.
  return Response.json({ google, microsoft, email: await emailSignInAvailable(), azure, azureStaff: azure ? azureStaffProviderName() : "" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
