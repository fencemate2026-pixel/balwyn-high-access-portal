/**
 * Owner sites — server-side data access for the gd_* (GSM gate dialler) tables.
 * Never imported by browser code.
 *
 * Access path: Supabase REST with the service role, through supabaseFetch (the
 * same server credential the portal already holds). The portal's own tables go
 * through the balwyn-portal-db Edge Function as the restricted balwyn_app role;
 * that role is deliberately NOT granted the gd_* tables, so a school-portal bug
 * can never reach another client's whitelist. Only the owner-gated route
 * (app/api/owner/sites) calls this module.
 *
 * Every write is scoped to the site being viewed (site_id filter on the row
 * itself, or the unit's site for schedules), so a request can never change a
 * row belonging to a different site by guessing an id.
 *
 * Every write stamps last_actor (the signed-in owner's email) and
 * last_authorised_by (the person the owner is acting for). A database trigger
 * copies both into gd_changes and bumps the site's config_version, which the
 * gate units long-poll: an online unit applies the change in about 1-2 s.
 */
import { supabaseFetch } from "@/lib/supabase-server";
import { OwnerSiteInputError, isSlug, isUuid } from "@/lib/owner-sites-model";

const UNIT_COLUMNS = "id,site_id,device_id,name,gate_type,sim_number,enabled,lockdown,pulse_seconds,last_seen,last_status,applied_version,fw_version,last_authorised_by,secret_hash";

export class OwnerSitesUnavailableError extends Error {}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") headers.set("Prefer", "return=representation");
  const response = await supabaseFetch(`/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // Unique phone per site: give a plain answer rather than a database error.
    if (response.status === 409 || body.includes("duplicate key")) throw new OwnerSiteInputError("That number is already on this site's list.");
    if (body.includes("violates check constraint")) throw new OwnerSiteInputError("One of the values is not allowed.");
    console.warn("owner_sites_rest_failed", response.status);
    throw new OwnerSitesUnavailableError("Site data is not available right now.");
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

const enc = encodeURIComponent;

/** Never send the stored key hash to the browser; say only whether it is set. */
function publicUnit(u: Record<string, unknown>) {
  const { secret_hash, ...rest } = u;
  return { ...rest, has_device_key: typeof secret_hash === "string" && secret_hash.length === 64 };
}

export async function listSites() {
  const sites = await rest<Array<Record<string, unknown>>>(
    "gd_sites?select=id,slug,name,address,config_version,gd_units(id,last_seen,applied_version,enabled,lockdown)&order=name");
  return sites;
}

export async function getSiteBySlug(slug: string) {
  if (!isSlug(slug)) throw new OwnerSiteInputError("Unknown site.");
  const rows = await rest<Array<Record<string, unknown>>>(`gd_sites?slug=eq.${enc(slug)}&select=*`);
  if (!rows.length) throw new OwnerSiteInputError("Unknown site.");
  return rows[0];
}

export async function getSiteDetail(slug: string) {
  const site = await getSiteBySlug(slug);
  const sid = String(site.id);
  const units = await rest<Array<Record<string, unknown>>>(`gd_units?site_id=eq.${sid}&select=${UNIT_COLUMNS}&order=name`);
  const unitIds = units.map((u) => String(u.id));
  const [whitelist, schedules, persons] = await Promise.all([
    rest(`gd_whitelist?site_id=eq.${sid}&select=id,name,phone_e164,unit_label,enabled,last_authorised_by,updated_at&order=unit_label.nullsfirst,name`),
    unitIds.length
      ? rest(`gd_schedules?unit_id=in.(${unitIds.join(",")})&select=id,unit_id,name,days,open_time,close_time,span_days,enabled&order=name`)
      : Promise.resolve([]),
    rest(`gd_auth_persons?site_id=eq.${sid}&select=id,name,role,phone&order=name`),
  ]);
  return { site, units: units.map(publicUnit), whitelist, schedules, persons };
}

export async function listCalls(siteId: string, opts: { unitId?: string; result?: string } = {}) {
  if (!isUuid(siteId)) throw new OwnerSiteInputError("Unknown site.");
  let q = `gd_call_events?site_id=eq.${siteId}&select=id,unit_id,occurred_at,phone_e164,caller_name,result,detail&order=occurred_at.desc&limit=300`;
  if (opts.unitId && isUuid(opts.unitId)) q += `&unit_id=eq.${opts.unitId}`;
  if (opts.result && /^[a-z_]{3,40}$/.test(opts.result)) q += `&result=eq.${opts.result}`;
  return rest(q);
}

export async function listChanges(siteId: string) {
  if (!isUuid(siteId)) throw new OwnerSiteInputError("Unknown site.");
  return rest(`gd_changes?site_id=eq.${siteId}&select=id,at,actor_email,authorised_by,entity,action,detail&order=at.desc&limit=300`);
}

type Stamp = { last_actor: string; last_authorised_by: string };

async function unitInSite(unitId: unknown, siteId: string) {
  if (!isUuid(unitId)) throw new OwnerSiteInputError("Unknown gate unit.");
  const rows = await rest<Array<{ id: string }>>(`gd_units?id=eq.${unitId}&site_id=eq.${siteId}&select=id`);
  if (!rows.length) throw new OwnerSiteInputError("Unknown gate unit.");
  return String(unitId);
}

/** Stamp who did it, then delete, so the trigger's audit row records the right people. */
async function stampThenDelete(table: string, filter: string, stamp: Stamp) {
  const updated = await rest<unknown[]>(`${table}?${filter}`, { method: "PATCH", body: JSON.stringify(stamp) });
  if (!updated?.length) throw new OwnerSiteInputError("That entry no longer exists.");
  await rest(`${table}?${filter}`, { method: "DELETE" });
}

export async function addWhitelist(siteId: string, row: Record<string, unknown>, stamp: Stamp) {
  return rest("gd_whitelist", { method: "POST", body: JSON.stringify({ ...row, site_id: siteId, ...stamp }) });
}

export async function updateWhitelist(siteId: string, id: unknown, change: Record<string, unknown>, stamp: Stamp) {
  if (!isUuid(id)) throw new OwnerSiteInputError("Unknown entry.");
  const rows = await rest<unknown[]>(`gd_whitelist?id=eq.${id}&site_id=eq.${siteId}`, { method: "PATCH", body: JSON.stringify({ ...change, ...stamp }) });
  if (!rows?.length) throw new OwnerSiteInputError("That entry no longer exists.");
}

export async function deleteWhitelist(siteId: string, id: unknown, stamp: Stamp) {
  if (!isUuid(id)) throw new OwnerSiteInputError("Unknown entry.");
  await stampThenDelete("gd_whitelist", `id=eq.${id}&site_id=eq.${siteId}`, stamp);
}

export async function saveSchedule(siteId: string, unitId: unknown, id: unknown, row: Record<string, unknown>, stamp: Stamp) {
  const uid = await unitInSite(unitId, siteId);
  if (id === undefined || id === null || id === "") {
    return rest("gd_schedules", { method: "POST", body: JSON.stringify({ ...row, unit_id: uid, ...stamp }) });
  }
  if (!isUuid(id)) throw new OwnerSiteInputError("Unknown window.");
  const rows = await rest<unknown[]>(`gd_schedules?id=eq.${id}&unit_id=eq.${uid}`, { method: "PATCH", body: JSON.stringify({ ...row, ...stamp }) });
  if (!rows?.length) throw new OwnerSiteInputError("That window no longer exists.");
}

export async function deleteSchedule(siteId: string, unitId: unknown, id: unknown, stamp: Stamp) {
  const uid = await unitInSite(unitId, siteId);
  if (!isUuid(id)) throw new OwnerSiteInputError("Unknown window.");
  await stampThenDelete("gd_schedules", `id=eq.${id}&unit_id=eq.${uid}`, stamp);
}

export async function updateUnit(siteId: string, unitId: unknown, change: Record<string, unknown>, stamp: Stamp) {
  const uid = await unitInSite(unitId, siteId);
  await rest(`gd_units?id=eq.${uid}&site_id=eq.${siteId}`, { method: "PATCH", body: JSON.stringify({ ...change, ...stamp }) });
}

export async function addPerson(siteId: string, row: Record<string, unknown>, stamp: Stamp) {
  return rest("gd_auth_persons", { method: "POST", body: JSON.stringify({ ...row, site_id: siteId, ...stamp }) });
}

export async function deletePerson(siteId: string, id: unknown, stamp: Stamp) {
  if (!isUuid(id)) throw new OwnerSiteInputError("Unknown person.");
  await stampThenDelete("gd_auth_persons", `id=eq.${id}&site_id=eq.${siteId}`, stamp);
}

/**
 * Confirm a large whitelist removal. Units refuse to apply a list that drops by
 * more than 10 % unless the version they receive carries this confirmation.
 * Optimistic: only succeeds if nobody changed the site since the page loaded.
 */
export async function acknowledgeShrink(siteId: string, seenVersion: unknown) {
  const v = Number(seenVersion);
  if (!Number.isSafeInteger(v) || v < 1) throw new OwnerSiteInputError("Reload the page and try again.");
  const rows = await rest<unknown[]>(`gd_sites?id=eq.${siteId}&config_version=eq.${v}`, {
    method: "PATCH", body: JSON.stringify({ config_version: v + 1, shrink_ack_version: v + 1 }),
  });
  if (!rows?.length) throw new OwnerSiteInputError("The list changed since you loaded it. Reload and confirm again.");
}
