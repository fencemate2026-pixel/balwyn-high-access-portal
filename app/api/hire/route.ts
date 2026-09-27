import { getSql } from "@/db";
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import { defaultGatesForArea, GATES, isGateActive } from "@/lib/portal-model";

export const dynamic = "force-dynamic";

const AREAS = new Set([
  "tony-frizza-stadium",
  "oval",
  "tennis-courts",
  "gymnasium",
  "car-park",
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function validEmail(value: string) {
  const at = value.indexOf("@");
  const dot = value.lastIndexOf(".");
  return at > 0 && dot > at + 1 && dot < value.length - 1 && !value.includes(" ");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Calendar reads: occurrences inside the requested date window (Melbourne
// dates, inclusive). Without a window the next 9 weeks are returned, starting
// one week back. Previously the first 40 rows ever were returned, so once
// history built up, current bookings would have stopped appearing.
// Hirer email and phone are personal information: they are only returned to
// operators and administrators, never to viewers.
export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) return json({ error: "Dates must be YYYY-MM-DD." }, 400);
  if (from && to && to < from) return json({ error: "The end date must not be before the start date." }, 400);
  const showContact = auth.user.role !== "viewer";
  try {
    const d1 = getSql();
    const areas = await d1.prepare(
      "SELECT key, label, active, sort_order FROM hire_areas ORDER BY sort_order",
    ).all<{ key: string; label: string; active: boolean; sort_order: number }>();
    const contact = showContact ? "email, phone," : "";
    const visits = await d1.prepare(
      `SELECT occurrence_id, booking_id, schedule_name, full_name, organisation, ${contact} occurs_on, starts_at, ends_at,
              duration_hours, areas, status, deposit_status, deposit_amount
         FROM hire_schedule_view
        WHERE occurs_on BETWEEN COALESCE(?::date, (now() AT TIME ZONE 'Australia/Melbourne')::date - 7)
                            AND COALESCE(?::date, (now() AT TIME ZONE 'Australia/Melbourne')::date + 56)
        ORDER BY starts_at
        LIMIT 500`,
    ).bind(from || null, to || null).all<Record<string, unknown>>();
    if (!areas.results.length) {
      return json({
        areas: [],
        visits: [],
        source: "unavailable",
        error: "No hire areas in balwyn_portal. The directory fallback has been removed.",
      });
    }
    return json({
      areas: areas.results,
      visits: visits.results,
      source: "database",
    });
  } catch (reason) {
    return json({
      areas: [],
      visits: [],
      source: "unavailable",
      error: reason instanceof Error ? reason.message : "Hire database query failed.",
    }, 503);
  }
}

// Booking save: one database transaction (the portal DB function wraps a batch
// in BEGIN…COMMIT under a single advisory lock), so a booking is either saved
// completely — client, booking, space, occurrence, gate links, comment and
// activity-log entry — or not at all. Two bookings for the same space at
// overlapping times are refused with 409, race-free because the clash test runs
// inside the same locked transaction as the insert.
const MAX_GATES = 4;

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return json({ error: "Request rejected." }, 403);
  const auth = await requireOperator(request, "operator");
  if (!auth.user) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fullName = String(body?.fullName ?? "").trim();
  const email = String(body?.email ?? "").trim() || null;
  const phone = String(body?.phone ?? "").trim() || null;
  const area = String(body?.area ?? "").trim();
  const visitDate = String(body?.date ?? "").trim();
  const startTime = String(body?.startTime ?? "").trim();
  const endTime = String(body?.endTime ?? "").trim();
  const comment = String(body?.comment ?? "").trim();
  const depositLeft = Boolean(body?.depositLeft);
  const depositAmount = Number(body?.depositAmount ?? 0);
  // Gates open automatically for the booked space (HIRE_AREA_GATES). Staff may
  // send an explicit list instead, including [] to open no gate for this booking.
  const gateIds = Array.isArray(body?.gateIds) ? [...new Set(body.gateIds.map(String))] : defaultGatesForArea(String(body?.area ?? "").trim());
  const leadMinutes = body?.leadMinutes === undefined ? 15 : Number(body.leadMinutes);
  const lagMinutes = body?.lagMinutes === undefined ? 15 : Number(body.lagMinutes);
  if (fullName.length < 1 || fullName.length > 120) return json({ error: "Enter the client's full name." }, 400);
  if (email && !validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
  if (phone && (phone.length < 6 || phone.length > 40)) return json({ error: "Enter a valid phone number." }, 400);
  if (!AREAS.has(area)) return json({ error: "Choose a hire space." }, 400);
  if (!ISO_DATE.test(visitDate)) return json({ error: "Choose the hire date." }, 400);
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return json({ error: "Enter start and end times." }, 400);
  if (endTime <= startTime) return json({ error: "End time must be after start time." }, 400);
  if (depositLeft && !(depositAmount > 0)) return json({ error: "Enter the deposit amount." }, 400);
  if (comment.length > 4000) return json({ error: "The comment is too long." }, 400);
  if (gateIds.length > MAX_GATES || gateIds.some((id) => !isGateActive(id))) return json({ error: "Choose only active gates to open for this booking." }, 400);
  for (const minutes of [leadMinutes, lagMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120) return json({ error: "Gate lead-in and run-out must be 0 to 120 minutes." }, 400);
  }

  const d1 = getSql();
  const newClientId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  const start = `${startTime}:00`;
  const end = `${endTime}:00`;
  // The clash condition every write depends on: another live occurrence in the same space overlapping this one.
  const noClash = `NOT EXISTS (
      SELECT 1 FROM hire_booking_occurrences o
        JOIN hire_bookings b ON b.id = o.booking_id
        JOIN hire_booking_areas a ON a.booking_id = b.id
       WHERE a.area_key = ? AND o.cancelled = false AND b.status IN ('enquiry', 'confirmed')
         AND o.starts_at < ((?::date + ?::time) AT TIME ZONE 'Australia/Melbourne')
         AND o.ends_at   > ((?::date + ?::time) AT TIME ZONE 'Australia/Melbourne'))`;
  const clashParams = [area, visitDate, end, visitDate, start];
  const clientId = `COALESCE((SELECT id FROM hire_clients WHERE ?::text IS NOT NULL AND lower(email) = lower(?) AND archived = false LIMIT 1), ?::uuid)`;
  const bookingExists = "EXISTS (SELECT 1 FROM hire_bookings WHERE id = ?::uuid)";
  const gateNames = gateIds.map((id) => GATES.find((gate) => gate.id === id)?.name ?? id).join(", ");

  const statements = [
    // 1. Client: reuse by email, else create — only if the slot is free.
    d1.prepare(`INSERT INTO hire_clients (id, full_name, email, phone, created_by)
                SELECT ?::uuid, ?, ?, ?, ? WHERE ${noClash}
                  AND NOT EXISTS (SELECT 1 FROM hire_clients WHERE ?::text IS NOT NULL AND lower(email) = lower(?) AND archived = false)`)
      .bind(newClientId, fullName, email, phone, auth.user.email, ...clashParams, email, email),
    d1.prepare(`UPDATE hire_clients SET full_name = ?, phone = COALESCE(?, phone), updated_at = now()
                 WHERE ?::text IS NOT NULL AND lower(email) = lower(?) AND archived = false AND ${noClash}`)
      .bind(fullName, phone, email, email, ...clashParams),
    // 2. Booking (the row everything else hangs off).
    d1.prepare(`INSERT INTO hire_bookings (id, client_id, name, recurrence, booking_date, start_time, end_time, status, deposit_status, deposit_amount, created_by)
                SELECT ?::uuid, ${clientId}, ?, 'one_off', ?::date, ?::time, ?::time, 'confirmed', ?::balwyn_portal.hire_deposit, ?, ? WHERE ${noClash}`)
      .bind(bookingId, email, email, newClientId, `${fullName} — ${visitDate}`, visitDate, start, end,
        depositLeft ? "held" : "not_required", depositLeft ? depositAmount : 0, auth.user.email, ...clashParams),
    d1.prepare(`INSERT INTO hire_booking_areas (booking_id, area_key) SELECT ?::uuid, ? WHERE ${bookingExists}`).bind(bookingId, area, bookingId),
    d1.prepare(`INSERT INTO hire_booking_occurrences (booking_id, occurs_on, starts_at, ends_at)
                SELECT ?::uuid, ?::date, ((?::date + ?::time) AT TIME ZONE 'Australia/Melbourne'), ((?::date + ?::time) AT TIME ZONE 'Australia/Melbourne')
                 WHERE ${bookingExists}`).bind(bookingId, visitDate, visitDate, start, visitDate, end, bookingId),
    ...gateIds.map((gateId) => d1.prepare(
      `INSERT INTO hire_booking_gates (booking_id, gate_id, lead_minutes, lag_minutes, created_by) SELECT ?::uuid, ?, ?, ?, ? WHERE ${bookingExists}`,
    ).bind(bookingId, gateId, leadMinutes, lagMinutes, auth.user.email, bookingId)),
    ...(comment ? [d1.prepare(
      `INSERT INTO hire_comments (client_id, booking_id, body, author) SELECT b.client_id, b.id, ?, ? FROM hire_bookings b WHERE b.id = ?::uuid`,
    ).bind(comment, auth.user.email, bookingId)] : []),
    d1.prepare(`INSERT INTO activity_log (action, detail, category, actor_name, actor_role) SELECT ?, ?, 'hire', ?, ? WHERE ${bookingExists}`).bind(
      "Stadium hire booked",
      `${fullName}, ${visitDate} ${startTime}–${endTime}${gateIds.length ? `. Gate held open: ${gateNames} (${leadMinutes} min before, ${lagMinutes} min after)` : ""}.`,
      auth.user.displayName, auth.user.role, bookingId),
    d1.prepare("SELECT id, client_id FROM hire_bookings WHERE id = ?::uuid").bind(bookingId),
  ];
  try {
    const results = await d1.batch<{ id: string; client_id: string }>(statements);
    const saved = results[results.length - 1]?.results[0];
    if (!saved) return json({ error: "That space is already booked at an overlapping time. Choose another time or space." }, 409);
    return json({ ok: true, clientId: saved.client_id, bookingId: saved.id, gateIds });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "Hire record could not be saved." }, 500);
  }
}
