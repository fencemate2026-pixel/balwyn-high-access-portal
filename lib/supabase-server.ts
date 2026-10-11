/**
 * Server-side Supabase access (service role). Never imported by browser code.
 *
 * FUNCTION REGION (12 Oct 2026)
 * Every portal database query goes through the `balwyn-portal-db` Edge Function.
 * By default Supabase runs an Edge Function in the region nearest the CALLER.
 * With the website hosted on Render in Oregon (USA), the function ran in
 * us-west-2 while the database is in Sydney (ap-southeast-2), so each query paid
 * several trans-Pacific round trips inside the function: 2.4-3.5 s per call in
 * the Supabase function logs of 11 Oct 2026, against 0.22-0.25 s for the same
 * function called from the Azure Australia East copy. Email sign-in makes seven
 * calls in sequence, took about 20 s on Render, and the browser's 20 s limit
 * aborted it ("signal timed out") although the server did finish the sign-in.
 *
 * The fix pins Edge Function execution to the database's region with Supabase's
 * documented `x-region` header (Regional Invocations). Storage calls are not
 * Edge Functions and are left unchanged.
 *
 * Override with SUPABASE_FUNCTION_REGION:
 *   - a region code such as "ap-southeast-2" pins execution to that region;
 *   - "auto" restores Supabase's nearest-to-caller routing.
 * Supabase does not re-route a pinned request during a regional outage, so
 * "auto" is the switch to use if Sydney Edge Functions are ever unavailable.
 */

/** Region of the Supabase project's database (project aevsfrxqyvtuycufffxk). */
const DATABASE_REGION = "ap-southeast-2";

/** AWS-style region code, e.g. ap-southeast-2, us-west-2, eu-central-1. */
const REGION_CODE = /^[a-z]{2}-[a-z]+-\d$/;

export function supabaseSettings() {
  const value = process.env.SUPABASE_URL ?? process.env.SUPABASE_DATABASE_URL ?? "";
  const url = new URL(value);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || !key) {
    throw new Error("Server database configuration is unavailable.");
  }
  return { origin: url.origin, key };
}

/**
 * Region to pin Edge Function execution to, or null for Supabase's automatic
 * routing. An unrecognised override falls back to the database region rather
 * than silently disabling the pin, so a typo cannot reintroduce the slowdown.
 */
export function edgeFunctionRegion(): string | null {
  const configured = (process.env.SUPABASE_FUNCTION_REGION ?? "").trim().toLowerCase();
  if (configured === "auto") return null;
  if (configured && REGION_CODE.test(configured)) return configured;
  if (configured) console.warn("SUPABASE_FUNCTION_REGION is not a region code or 'auto'; using the database region.");
  return DATABASE_REGION;
}

export async function supabaseFetch(path: string, init: RequestInit = {}) {
  const { origin, key } = supabaseSettings();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  if (path.startsWith("/functions/v1/")) {
    const region = edgeFunctionRegion();
    if (region) headers.set("x-region", region);
  }
  return fetch(`${origin}${path}`, { ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
}
