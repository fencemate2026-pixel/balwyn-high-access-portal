import { clientAddressSource } from "@/lib/client-address";
import { getSql } from "@/db";

// Checks process liveness AND a lightweight Supabase read; this endpoint still
// never seeds data or issues commands. `clientAddressSource` names which
// platform header supplies visitor addresses for sign-in rate limits ("azure"
// or "cloudflare"); it never includes an address.
//
// DB CHECK (AUDIT_INFRA.md finding #6, 18 Oct 2026)
// Docker's HEALTHCHECK, Azure App Service's healthCheckPath and (legacy)
// Render's healthCheckPath (Dockerfile, deploy/azure/provision.sh, render.yaml)
// all poll this endpoint as the sole signal of whether the app is serving.
// Checking process liveness only meant a Supabase outage, or a bad
// SUPABASE_URL/service-role key shipped in a deploy, reported "healthy" at
// every layer while sign-in, gate status and bookings were actually broken.
// `select 1` is the cheapest possible round trip through the existing
// `balwyn-portal-db` Edge Function (db/postgres-client.ts); it proves the
// Supabase URL, key and function are all reachable without touching any real
// table. Bounded to DB_CHECK_TIMEOUT_MS so a slow/hanging Supabase call cannot
// make this endpoint itself hang past the platform's own health-check timeout.
export const dynamic = "force-dynamic";

const DB_CHECK_TIMEOUT_MS = 3000;

async function databaseReachable(): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Database health check timed out")), DB_CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([getSql().prepare("select 1").first(), timeout]);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const databaseOk = await databaseReachable();
  const body = {
    status: databaseOk ? "ok" : "degraded",
    database: databaseOk ? "ok" : "unreachable",
    clientAddressSource: clientAddressSource(),
  };
  // A non-2xx status is what makes Docker's HEALTHCHECK, Azure's
  // healthCheckPath and the GitHub Actions deploy gate treat this as unhealthy.
  return Response.json(body, { status: databaseOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
