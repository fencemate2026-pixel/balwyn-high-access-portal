// Process health only; this endpoint does not touch the database, seed data or
// issue commands. Azure's health check and the deploy workflow poll it.
//
// `version` is the commit the running image was built from (APP_VERSION, baked in
// by the Dockerfile). The deploy waits until it reports the commit just deployed,
// so the old container answering during shutdown can no longer pass as a
// successful release (30 Oct 2026 outage). It reveals nothing beyond the public
// commit id. The earlier `clientAddressSource` field was removed (audit L3).
export const dynamic = "force-dynamic";

function appVersion(): string {
  const value = (process.env.APP_VERSION ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(value) ? value : "unknown";
}

export function GET() {
  return Response.json({ status: "ok", version: appVersion() }, { headers: { "Cache-Control": "no-store" } });
}
