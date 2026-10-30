// Deep health (audit M1, 30 Oct 2026): proves the portal can reach its database,
// for an external uptime monitor. /api/health stays shallow on purpose: Azure
// replaces an instance that fails its health path, and a database outage must not
// make Azure recycle a healthy web server.
//
// Public and unauthenticated, so the database is asked at most once every
// 15 seconds per server; other requests reuse that answer. The response carries
// no data, only whether the check passed and how long it took.
import { getSql } from "@/db";

export const dynamic = "force-dynamic";

const CACHE_MS = 15_000;
let cached: { at: number; ok: boolean; ms: number } | null = null;
let inFlight: Promise<{ at: number; ok: boolean; ms: number }> | null = null;

async function probe() {
  const started = Date.now();
  try {
    const row = await getSql().prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return { at: Date.now(), ok: Number(row?.ok) === 1, ms: Date.now() - started };
  } catch {
    return { at: Date.now(), ok: false, ms: Date.now() - started };
  }
}

export async function GET() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    inFlight ??= probe().finally(() => { inFlight = null; });
    cached = await inFlight;
  }
  return Response.json(
    { status: cached.ok ? "ok" : "database_unavailable", databaseMs: cached.ms, checkedAt: new Date(cached.at).toISOString() },
    { status: cached.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
