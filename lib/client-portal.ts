/**
 * Which client page a slug opens. No database and no gate writes.
 * macquarie, macquarie-drive and thomastown are the one live resident app.
 * Every other valid slug is its own page and must not share that app's callers.
 */
import { isSlug } from "./owner-sites-model.ts";

const MACQUARIE_SLUGS = new Set(["macquarie", "macquarie-drive", "thomastown"]);

export type ClientAppKind = "macquarie" | "site" | "invalid";

export function clientAppKind(slug: string): ClientAppKind {
  if (!isSlug(slug)) return "invalid";
  if (MACQUARIE_SLUGS.has(slug)) return "macquarie";
  return "site";
}

/** Same Magic Keys portal, on a phone or a computer. Null when the slug is not a site id. */
export function clientPageHref(slug: string): string | null {
  const kind = clientAppKind(slug);
  if (kind === "invalid") return null;
  if (kind === "macquarie") return "/macquarie";
  return `/c/${slug}`;
}

/** Desktop owner screens for these units open the Macquarie client page on this portal. */
const DEVICE_CLIENT_PAGES: Record<string, string> = {
  "thomastown-swing": "/macquarie",
  "thomastown-sliding": "/macquarie",
};

export function deviceClientHref(deviceId: string): string | null {
  return DEVICE_CLIENT_PAGES[deviceId] ?? null;
}
