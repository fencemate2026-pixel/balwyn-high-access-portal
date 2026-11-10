/**
 * Owner sites — the RJL sites that are NOT GSM gate diallers, so they have no
 * rows in the gd_* tables but still belong in the owner's one list of sites.
 * 30 Oct 2026 (Jarrod): "choose any of my sites and it will open up the exact
 * page".
 *
 * Server-only. This list is returned only by the owner-gated GET
 * /api/owner/sites, so the addresses below never ship in the public browser
 * bundle and school staff never receive them.
 *
 * kind:
 *  - "portal": a view inside this portal (opens in place, no new tab).
 *  - "view": a screen inside this portal backed by the Azure gd schema (not the Supabase gd_* tables),
 *    e.g. the Thomastown swing and sliding gates (app/thomastown-swing-view.tsx). Opens in place.
 *  - "external": a separate dashboard, opened in a new tab. These are not
 *    monitored from here, so the panel shows no online/offline dot for them.
 */
export type OwnerSiteLink =
  | { id: string; name: string; detail: string; kind: "portal"; view: "dashboard" }
  | { id: string; name: string; detail: string; kind: "view" }
  | { id: string; name: string; detail: string; kind: "external"; url: string; note: string };

export const OWNER_SITE_LINKS: readonly OwnerSiteLink[] = [
  {
    id: "balwyn",
    name: "Balwyn High School",
    detail: "This portal · campus gates, schedules, hire",
    kind: "portal",
    view: "dashboard",
  },
  {
    id: "settlement-road-swing",
    name: "Settlement Road Swing Gate",
    detail: "Azure · callers stored here, no dial-in number yet",
    kind: "view",
  },
  {
    id: "thomastown-swing",
    name: "Macquarie Drive Thomastown",
    detail: "Azure · callers, every call, changes",
    kind: "view",
  },
  {
    id: "thomastown-sliding",
    name: "Thomastown sliding gate",
    detail: "Azure · callers, every call, changes",
    kind: "view",
  },
  // Mildura now reports to gd_sites (slug "mildura") through the read-only mirror,
  // so it is listed with the other sites and opens in place (app/mildura-site-view.tsx).
];
