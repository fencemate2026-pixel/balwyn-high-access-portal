/**
 * The visitor's IP address, as reported by the hosting platform's front end.
 *
 * Used only for sign-in rate limits and the authenticator-step fingerprint. It
 * must come from a header the platform SETS (overwriting anything the browser
 * sent); a header a browser can supply itself would let one person bypass the
 * per-address limit, and a missing header puts every visitor in one shared
 * bucket so a handful of failed attempts locks the whole school out.
 *
 * WHY THIS EXISTS (12 Oct 2026)
 * Every caller previously read `cf-connecting-ip`. That header is set by
 * Cloudflare, which sits in front of Render. Azure App Service has no
 * Cloudflare in front of it (GoDaddy DNS points straight at azurewebsites.net),
 * so on Azure the header was absent for real visitors - every sign-in shared
 * the key "unknown" (24 email sign-ins per 15 minutes for the whole site) - and
 * any browser could send its own `cf-connecting-ip` to dodge the limit.
 *
 * SOURCES
 *  - "azure": App Service front ends add `client-ip` and "will overwrite any
 *    existing header so they cannot be spoofed" (Azure/app-service-linux-docs,
 *    Things_You_Should_Know/headers.md). Observed values carry a port
 *    ("203.0.113.157:63546"); `x-client-ip` carries the bare address. Both are
 *    read, port stripped. `cf-connecting-ip` is ignored on Azure.
 *  - "cloudflare": Render (behind Cloudflare). Unchanged behaviour.
 *
 * Selection: PORTAL_CLIENT_ADDRESS_SOURCE ("azure" | "cloudflare") if set,
 * otherwise "azure" when App Service's WEBSITE_SITE_NAME variable is present,
 * otherwise "cloudflare".
 */

export type ClientAddressSource = "azure" | "cloudflare";

const UNKNOWN = "unknown";
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i;
const IPV6 = /^[0-9a-f:.]+$/i;

export function clientAddressSource(): ClientAddressSource {
  const configured = (process.env.PORTAL_CLIENT_ADDRESS_SOURCE ?? "").trim().toLowerCase();
  if (configured === "azure" || configured === "cloudflare") return configured;
  return process.env.WEBSITE_SITE_NAME ? "azure" : "cloudflare";
}

/** Normalises one header value to a bare IPv4/IPv6 address, or null if it is not one. */
export function normaliseAddress(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value || value.length > 64) return null;
  const v4WithPort = IPV4_WITH_PORT.exec(value);
  if (v4WithPort) return v4WithPort[1];
  if (IPV4.test(value)) return value;
  const bracketed = BRACKETED_IPV6.exec(value);
  if (bracketed) return bracketed[1].toLowerCase();
  // A bare IPv6 address always has at least two colons; one colon is host:port.
  if ((value.match(/:/g)?.length ?? 0) >= 2 && IPV6.test(value)) return value.toLowerCase();
  return null;
}

/** The visitor's address for rate limiting, or "unknown" when the platform supplied none. */
export function clientAddress(request: Request): string {
  const headers = request.headers;
  if (clientAddressSource() === "azure") {
    return normaliseAddress(headers.get("client-ip")) ?? normaliseAddress(headers.get("x-client-ip")) ?? UNKNOWN;
  }
  return normaliseAddress(headers.get("cf-connecting-ip")) ?? UNKNOWN;
}
