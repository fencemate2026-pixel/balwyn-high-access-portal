/**
 * Azure App Service Authentication ("Easy Auth") identity bridge: header parsing.
 *
 * Azure signs the person in (Google for the owner, Microsoft Entra External ID
 * for staff) BEFORE the request reaches this app, and passes the result in
 * X-MS-CLIENT-PRINCIPAL* headers. Microsoft documents that external requests
 * cannot set these headers, so they are present only when App Service set them.
 *
 * Defence in depth, all enforced here:
 *  1. Opt-in. Nothing is read unless PORTAL_AZURE_AUTH is "on". Rollback is to
 *     unset that one setting. On any host without Easy Auth (Render, local) the
 *     headers are ignored.
 *  2. Fail closed. Any missing, malformed or unexpected field denies sign-in.
 *  3. Fresh login only. The identity token must have been issued within
 *     AZURE_LOGIN_MAX_AGE_MS. A lingering Azure session cookie on a shared
 *     school computer therefore cannot be turned into a portal session.
 *
 * This module only parses and validates. Who is APPROVED (roles, owner) is
 * decided in lib/azure-signin.ts against the portal's own allow-lists.
 *
 * EVIDENCE: the claim names below follow the OpenID Connect standard and
 * Microsoft's documented principal format. They have NOT yet been observed on
 * the live Azure app. If a real sign-in is denied with reason `no_email` or
 * `no_issue_time`, the logged reason tells us which claim to adjust.
 */
import { env } from "@/lib/server-env";

/** A login older than this (from the identity token's issue time) is refused. */
export const AZURE_LOGIN_MAX_AGE_MS = 3 * 60 * 1000;
/** Tolerated clock difference between Azure's token issue time and this server. */
export const AZURE_CLOCK_SKEW_MS = 30 * 1000;
/** Upper bound on the principal header, so a hostile value cannot cost memory. */
const MAX_PRINCIPAL_HEADER_CHARS = 16 * 1024;
const MAX_EMAIL_CHARS = 254;

const EMAIL_CLAIMS = [
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "email",
  "emails",
  "preferred_username",
  "upn",
] as const;
const NAME_CLAIMS = ["name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] as const;
const SUBJECT_CLAIMS = ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier", "sub", "oid"] as const;
const ISSUED_AT_CLAIMS = ["iat", "auth_time"] as const;
const EMAIL_PATTERN = /^[^\s@|,]+@[^\s@|,]+\.[^\s@|,]+$/;

export type AzureDenyReason =
  | "disabled" | "no_principal" | "bad_principal" | "no_provider"
  | "no_email" | "email_unverified" | "no_issue_time" | "stale_login";

export type AzureIdentity = {
  /** Lower-case Azure identity provider name, e.g. "google" or the staff provider's name. */
  idp: string;
  email: string;
  name: string;
  subject: string;
};

export type AzureIdentityResult = { identity: AzureIdentity } | { denied: AzureDenyReason };

type Claim = { typ: string; val: string };

/** True when the owner has switched Azure sign-in on for this deployment. */
export function azureSignInEnabled(): boolean {
  return String(env.PORTAL_AZURE_AUTH ?? "").trim().toLowerCase() === "on";
}

function decodePrincipal(header: string): { auth_typ?: unknown; claims: Claim[] } | null {
  try {
    const binary = atob(header.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.claims)) return null;
    const claims = parsed.claims.filter((c: unknown): c is Claim => !!c && typeof c === "object"
      && typeof (c as Claim).typ === "string" && typeof (c as Claim).val === "string");
    return { auth_typ: parsed.auth_typ, claims };
  } catch {
    return null;
  }
}

function firstClaim(claims: Claim[], names: readonly string[]): string | null {
  for (const name of names) {
    const found = claims.find((c) => c.typ === name && c.val.trim());
    if (found) return found.val.trim();
  }
  return null;
}

/**
 * Reads and validates the Azure identity on a request.
 * `now` is injectable so tests can prove the freshness window.
 */
export function readAzureIdentity(headers: Headers, now: number = Date.now()): AzureIdentityResult {
  if (!azureSignInEnabled()) return { denied: "disabled" };
  const raw = headers.get("x-ms-client-principal");
  if (!raw) return { denied: "no_principal" };
  if (raw.length > MAX_PRINCIPAL_HEADER_CHARS) return { denied: "bad_principal" };
  const principal = decodePrincipal(raw);
  if (!principal) return { denied: "bad_principal" };

  const idp = (headers.get("x-ms-client-principal-idp") || (typeof principal.auth_typ === "string" ? principal.auth_typ : ""))
    .trim().toLowerCase();
  if (!idp || idp.length > 64) return { denied: "no_provider" };

  const email = (firstClaim(principal.claims, EMAIL_CLAIMS)
    ?? (headers.get("x-ms-client-principal-name")?.includes("@") ? headers.get("x-ms-client-principal-name")!.trim() : null) ?? "")
    .toLowerCase();
  if (!email || email.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(email)) return { denied: "no_email" };

  // Google always states whether it verified the address; require that it did.
  // Other providers may omit the claim, but if present it must not say "false".
  const verified = firstClaim(principal.claims, ["email_verified"]);
  if (verified !== null && verified.toLowerCase() !== "true") return { denied: "email_unverified" };
  if (idp === "google" && verified === null) return { denied: "email_unverified" };

  const issued = firstClaim(principal.claims, ISSUED_AT_CLAIMS);
  const issuedMs = issued && /^\d{9,11}$/.test(issued) ? Number(issued) * 1000 : NaN;
  if (!Number.isSafeInteger(issuedMs)) return { denied: "no_issue_time" };
  if (issuedMs > now + AZURE_CLOCK_SKEW_MS || now - issuedMs > AZURE_LOGIN_MAX_AGE_MS) return { denied: "stale_login" };

  const subject = firstClaim(principal.claims, SUBJECT_CLAIMS) ?? headers.get("x-ms-client-principal-id")?.trim() ?? "";
  const name = (firstClaim(principal.claims, NAME_CLAIMS) ?? email.split("@")[0]).slice(0, 120);
  return { identity: { idp, email, name, subject } };
}
