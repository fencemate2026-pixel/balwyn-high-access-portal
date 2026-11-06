/**
 * Decides who an Azure-authenticated person is in this portal.
 *
 * Azure (App Service Authentication) proves the identity; this module decides
 * whether that identity is APPROVED, using the portal's own lists. Two routes:
 *
 *  - idp "google": the owner/administrators. The email must be in
 *    GOOGLE_ALLOWED_EMAILS (same list as the existing Google button), and the
 *    role comes from that list. The owner email gets the owner view exactly as
 *    it does today with Google.
 *  - idp equal to AZURE_STAFF_IDP (the name Easy Auth gives the Entra External
 *    ID provider): view-only staff with an active per-person account.
 *    Never the owner, never operator or administrator.
 *
 * Any other provider is refused, including any other Microsoft tenant.
 */
import { env } from "@/lib/server-env";
import { googleAccountRoles } from "@/lib/auth-settings";
import { portalEmailAllowed } from "@/lib/owner-access";
import { azureGoogleIdentity, azureStaffAccount, isOwnerEmail, type SessionIdentity } from "@/lib/portal-auth";
import type { PortalUser } from "@/lib/portal-model";
import type { AzureIdentity } from "@/lib/azure-auth";

export type AzureUserResult =
  | { user: PortalUser; identity: SessionIdentity; method: string }
  | { denied: "provider_not_allowed" | "not_approved" | "owner_email_wrong_provider" };

/** The Easy Auth provider name of the staff (Entra External ID) sign-in, lower-case; "" when not set. */
export function azureStaffProviderName(): string {
  return String(env.AZURE_STAFF_IDP ?? "").trim().toLowerCase();
}

export async function resolveAzureUser(azure: AzureIdentity): Promise<AzureUserResult> {
  const email = azure.email.trim().toLowerCase();
  if (azure.idp === "google") {
    const role = googleAccountRoles().get(email);
    if (!role || !portalEmailAllowed(email)) return { denied: "not_approved" };
    const user: PortalUser = { displayName: azure.name || email.split("@")[0], email, role };
    return { user, identity: await azureGoogleIdentity(email), method: "Google account via Azure" };
  }
  const staffIdp = azureStaffProviderName();
  if (staffIdp && azure.idp === staffIdp) {
    // The owner's address may only come in through Google; a staff-provider
    // identity with that email is refused even if someone created it.
    if (isOwnerEmail(email)) return { denied: "owner_email_wrong_provider" };
    const account = await azureStaffAccount(email);
    if (!account) return { denied: "not_approved" };
    return { user: account.user, identity: account.identity, method: "Email and password via Azure (view-only account)" };
  }
  return { denied: "provider_not_allowed" };
}
