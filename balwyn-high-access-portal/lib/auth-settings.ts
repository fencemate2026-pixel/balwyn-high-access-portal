import { env } from "@/lib/server-env";

import { parseAccountRoles } from "./account-roles";

export function googleAccountRoles() {
  return parseAccountRoles(String(env.GOOGLE_ALLOWED_EMAILS ?? ""), identity => /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(identity));
}
// Microsoft email/UPN claims are mutable. Access is bound to tenant + object ID.
export function microsoftAccountRoles() {
  return parseAccountRoles(String(env.MICROSOFT_ALLOWED_ACCOUNTS ?? ""), identity => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identity));
}
export function microsoftAllowedAccounts(): Set<string> {
  return new Set(microsoftAccountRoles().keys());
}

export function microsoftSettings() {
  const clientId = String(env.MICROSOFT_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.MICROSOFT_OAUTH_CLIENT_SECRET ?? "").trim();
  const allowedAccounts = microsoftAllowedAccounts();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
    || !clientSecret || !allowedAccounts.size) throw new Error("Microsoft sign-in is not configured.");
  return { clientId, clientSecret, allowedAccounts, accountRoles: microsoftAccountRoles() };
}
