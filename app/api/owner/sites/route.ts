// Owner sites (GSM gate diallers) — 30 Oct 2026 (Jarrod).
// The Magic Keys OWNER only: a verified administrator session whose email matches
// PORTAL_OWNER_EMAIL (lib/owner-access.ts). School staff, including school
// administrators, get 404, so the section's existence is not disclosed.
// Every change: owner session, exact same-origin, bounded body, server-side
// validation (lib/owner-sites-model.ts), site-scoped writes, audit to gd_changes.
import { gdTransaction } from "@/lib/gd-db";
import { milduraOnAzure, mirrorDetail, siteRow } from "@/lib/gd-mildura-store";
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import { readBoundedText } from "@/lib/request-body";
import {
  OwnerSiteInputError, authorisedBy, personInput, scheduleInput, unitInput, whitelistImportInput, whitelistInput,
} from "@/lib/owner-sites-model";
import {
  OwnerSitesUnavailableError, acknowledgeShrink, addPerson, addWhitelist, deletePerson, deleteSchedule,
  deleteWhitelist, getMirrorDetail, getSiteBySlug, getSiteDetail, importWhitelist, listCalls, listChanges, listSites, saveSchedule,
  setAllWhitelistEnabled, updatePerson, updateUnit, updateWhitelist,
} from "@/lib/owner-sites-store";
import type { PortalUser } from "@/lib/portal-model";
import { OWNER_SITE_LINKS } from "@/lib/owner-sites-links";

const headers = { "Cache-Control": "no-store" };
const notFound = () => Response.json({ error: "Not found." }, { status: 404, headers });

async function owner(request: Request): Promise<PortalUser | null> {
  const auth = await requireOperator(request, "administrator");
  return auth.user && auth.user.isOwner === true ? auth.user : null;
}

function failure(error: unknown) {
  if (error instanceof OwnerSiteInputError) return Response.json({ error: error.message }, { status: 400, headers });
  if (error instanceof OwnerSitesUnavailableError) return Response.json({ error: error.message }, { status: 503, headers });
  console.warn("owner_sites_failed");
  return Response.json({ error: "Site data is not available right now." }, { status: 503, headers });
}

export async function GET(request: Request) {
  const user = await owner(request);
  if (!user) return notFound();
  const url = new URL(request.url);
  const slug = url.searchParams.get("site");
  const view = url.searchParams.get("view") ?? "detail";
  try {
    // links: the owner's non-dialler sites (Balwyn, Mildura), owner-only like everything here.
    if (!slug) {
      // The Azure-backed sites (Balwyn, Thomastown) are in `links` and do not depend on the Supabase
      // gd_sites list. If that list is down, still return the links so the sidebar keeps those portals,
      // and say so with sitesUnavailable instead of failing the whole response (7 Nov 2026).
      let sites: Awaited<ReturnType<typeof listSites>> = [];
      let sitesUnavailable = false;
      try { sites = await listSites(); } catch (error) {
        if (error instanceof OwnerSiteInputError) throw error;
        sitesUnavailable = true; console.warn("owner_sites_list_unavailable");
      }
      // Mildura on Azure (MILDURA_BACKEND=azure): its row comes from Azure, so it neither disappears when Supabase is
      // down nor appears twice (any Supabase "mildura" row is dropped).
      if (milduraOnAzure()) {
        sites = sites.filter((s) => String(s.slug) !== "mildura");
        try { const row = await gdTransaction((c) => siteRow(c)); if (row) sites = [...sites, row]; } catch { sitesUnavailable = true; console.warn("owner_sites_mildura_unavailable"); }
      }
      return Response.json({ sites, links: OWNER_SITE_LINKS, sitesUnavailable, serverTime: new Date().toISOString() }, { headers });
    }
    if (view === "calls") {
      const site = await getSiteBySlug(slug);
      return Response.json({ calls: await listCalls(String(site.id), {
        unitId: url.searchParams.get("unit") ?? undefined, result: url.searchParams.get("result") ?? undefined,
      }) }, { headers });
    }
    // Mildura mirror, including recorded access PINs. Owner check above runs before any reads.
    if (view === "mirror") {
      const detail = milduraOnAzure() && slug === "mildura" ? await gdTransaction((c) => mirrorDetail(c)) : await getMirrorDetail(slug);
      return Response.json({ ...detail, serverTime: new Date().toISOString() }, { headers });
    }
    if (view === "changes") {
      const site = await getSiteBySlug(slug);
      return Response.json({ changes: await listChanges(String(site.id)) }, { headers });
    }
    return Response.json({ ...(await getSiteDetail(slug)), serverTime: new Date().toISOString() }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const user = await owner(request);
  if (!user) return notFound();
  let body: Record<string, unknown>;
  try {
    const raw = await readBoundedText(request, 16384);
    if (raw === null) return Response.json({ error: "Invalid request." }, { status: 413, headers });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers });
  }
  try {
    const site = await getSiteBySlug(String(body.site ?? ""));
    const sid = String(site.id);
    const stamp = { last_actor: user.email, last_authorised_by: authorisedBy(body, user.displayName) };
    let imported: { added: number; skipped: number } | undefined;
    switch (body.action) {
      case "whitelist.add": await addWhitelist(sid, whitelistInput(body), stamp); break;
      case "whitelist.update": await updateWhitelist(sid, body.id, whitelistInput(body), stamp); break;
      case "whitelist.toggle": await updateWhitelist(sid, body.id, { enabled: body.enabled === true }, stamp); break;
      case "whitelist.enableAll": await setAllWhitelistEnabled(sid, body.enabled === true, stamp); break;
      case "whitelist.import": imported = await importWhitelist(sid, whitelistImportInput(body), stamp); break;
      case "whitelist.delete": await deleteWhitelist(sid, body.id, stamp); break;
      case "schedule.save": await saveSchedule(sid, body.unitId, body.id, scheduleInput(body), stamp); break;
      case "schedule.delete": await deleteSchedule(sid, body.unitId, body.id, stamp); break;
      case "unit.update": await updateUnit(sid, body.unitId, unitInput(body), stamp); break;
      case "person.add": await addPerson(sid, personInput(body), stamp); break;
      case "person.update": await updatePerson(sid, body.id, personInput(body), stamp); break;
      case "person.delete": await deletePerson(sid, body.id, stamp); break;
      case "site.ackShrink": await acknowledgeShrink(sid, body.seenVersion); break;
      default: return Response.json({ error: "Unknown action." }, { status: 400, headers });
    }
    return Response.json({ ok: true, ...(imported ? { imported } : {}), ...(await getSiteDetail(String(site.slug))), serverTime: new Date().toISOString() }, { headers });
  } catch (error) { return failure(error); }
}
