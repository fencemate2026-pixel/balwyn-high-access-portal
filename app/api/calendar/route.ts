// One calendar feed for the dashboard: facility-hire bookings AND every gate
// open window (weekly schedules, booking-linked gates, automation rules).
// Gate windows come from loadGateWindows() in lib/portal-store.ts — the same
// function the controller engine uses — so the calendar always shows what the
// gates will actually be asked to do.
//
// Hirer email and phone are never included here; the Facility hire page
// (/api/hire) keeps its own role-based contact rules.
import { getSql } from "@/db";
import { requireOperator } from "@/lib/portal-auth";
import { GATES } from "@/lib/portal-model";
import { loadGateWindows } from "@/lib/portal-store";
import { addDays, melbourneDate } from "@/lib/gate-windows";

export const dynamic = "force-dynamic";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  const url = new URL(request.url);
  const today = melbourneDate(new Date());
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || addDays(from, 6);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return json({ error: "Dates must be YYYY-MM-DD." }, 400);
  if (to < from) return json({ error: "The end date must not be before the start date." }, 400);
  if (addDays(from, MAX_DAYS) < to) return json({ error: `Ask for at most ${MAX_DAYS} days at a time.` }, 400);

  try {
    const [bookings, windows] = await Promise.all([
      getSql().prepare(
        `SELECT occurrence_id, booking_id, schedule_name, full_name, organisation, occurs_on, starts_at, ends_at, areas, status
           FROM hire_schedule_view
          WHERE occurs_on BETWEEN ?::date AND ?::date
          ORDER BY starts_at
          LIMIT 1000`,
      ).bind(from, to).all<Record<string, unknown>>(),
      loadGateWindows(from, to),
    ]);
    const gateName = (id: string) => GATES.find((gate) => gate.id === id)?.name ?? id;
    return json({
      from, to,
      bookings: bookings.results.map((row) => ({ ...row, occurs_on: String(row.occurs_on).slice(0, 10) })),
      gateWindows: windows.map((window) => ({ ...window, gateName: gateName(window.gateId), date: melbourneDate(new Date(window.start)) })),
    });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "Calendar could not be loaded." }, 503);
  }
}
