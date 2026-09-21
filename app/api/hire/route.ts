import { getSql } from "@/db";
import { requireOperator } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const DIRECTORY = [
  { key: "tony-frizza-stadium", label: "Tony Frizza Stadium", active: true, sort_order: 10 },
  { key: "oval", label: "Oval and grounds", active: true, sort_order: 20 },
  { key: "tennis-courts", label: "Tennis courts", active: true, sort_order: 30 },
  { key: "gymnasium", label: "Gymnasium", active: true, sort_order: 40 },
  { key: "car-park", label: "Car park", active: true, sort_order: 50 },
];

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  try {
    const d1 = getSql();
    const areas = await d1.prepare(
      "SELECT key, label, active, sort_order FROM hire_areas ORDER BY sort_order",
    ).all<{ key: string; label: string; active: boolean; sort_order: number }>();
    const visits = await d1.prepare(
      "SELECT occurrence_id, schedule_name, full_name, organisation, starts_at, ends_at, duration_hours, areas, status FROM hire_schedule_view ORDER BY starts_at LIMIT 40",
    ).all<Record<string, unknown>>();
    return json({
      areas: areas.results.length ? areas.results : DIRECTORY,
      visits: visits.results,
      source: areas.results.length ? "database" : "directory",
    });
  } catch {
    return json({ areas: DIRECTORY, visits: [], source: "directory" });
  }
}
