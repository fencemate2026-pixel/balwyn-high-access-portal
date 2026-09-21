import { getSql } from "@/db";
import { requireOperator } from "@/lib/portal-auth";

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

export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  try {
    const d1 = getSql();
    const areas = await d1.prepare(
      "SELECT key, label, active, sort_order FROM hire_areas ORDER BY sort_order",
    ).all<{ key: string; label: string; active: boolean; sort_order: number }>();
    const visits = await d1.prepare(
      "SELECT occurrence_id, schedule_name, full_name, organisation, starts_at, ends_at, duration_hours, areas, status, deposit_status, deposit_amount FROM hire_schedule_view ORDER BY starts_at LIMIT 40",
    ).all<Record<string, unknown>>();
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

export async function POST(request: Request) {
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
  if (fullName.length < 1 || fullName.length > 120) return json({ error: "Enter the client's full name." }, 400);
  if (email && !validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
  if (phone && (phone.length < 6 || phone.length > 40)) return json({ error: "Enter a valid phone number." }, 400);
  if (!AREAS.has(area)) return json({ error: "Choose a hire space." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return json({ error: "Choose the hire date." }, 400);
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return json({ error: "Enter start and end times." }, 400);
  if (endTime <= startTime) return json({ error: "End time must be after start time." }, 400);
  if (depositLeft && !(depositAmount > 0)) return json({ error: "Enter the deposit amount." }, 400);

  const d1 = getSql();
  try {
    let client = email
      ? await d1.prepare("SELECT id FROM hire_clients WHERE lower(email) = lower(?) AND archived = false").bind(email).first<{ id: string }>()
      : null;
    if (!client) {
      client = await d1.prepare(
        "INSERT INTO hire_clients (full_name, email, phone, created_by) VALUES (?, ?, ?, ?) RETURNING id",
      ).bind(fullName, email, phone, auth.user.email).first<{ id: string }>();
    } else {
      await d1.prepare("UPDATE hire_clients SET full_name = ?, phone = COALESCE(?, phone), updated_at = now() WHERE id = ?")
        .bind(fullName, phone, client.id).run();
    }
    if (!client?.id) return json({ error: "The client record could not be saved." }, 500);

    const booking = await d1.prepare(
      `INSERT INTO hire_bookings (
        client_id, name, recurrence, booking_date, start_time, end_time, status,
        deposit_status, deposit_amount, created_by
      ) VALUES (?, ?, 'one_off', ?::date, ?::time, ?::time, 'confirmed', ?, ?, ?) RETURNING id`,
    ).bind(
      client.id,
      `${fullName} — ${visitDate}`,
      visitDate,
      `${startTime}:00`,
      `${endTime}:00`,
      depositLeft ? "held" : "not_required",
      depositLeft ? depositAmount : 0,
      auth.user.email,
    ).first<{ id: string }>();
    if (!booking?.id) return json({ error: "The booking could not be saved." }, 500);

    await d1.prepare("INSERT INTO hire_booking_areas (booking_id, area_key) VALUES (?, ?)").bind(booking.id, area).run();
    await d1.prepare(
      `INSERT INTO hire_booking_occurrences (booking_id, occurs_on, starts_at, ends_at)
       VALUES (
         ?,
         ?::date,
         ((?::date + ?::time) AT TIME ZONE 'Australia/Melbourne'),
         ((?::date + ?::time) AT TIME ZONE 'Australia/Melbourne')
       )`,
    ).bind(booking.id, visitDate, visitDate, `${startTime}:00`, visitDate, `${endTime}:00`).run();

    if (comment) {
      await d1.prepare(
        "INSERT INTO hire_comments (client_id, booking_id, body, author) VALUES (?, ?, ?, ?)",
      ).bind(client.id, booking.id, comment, auth.user.email).run();
    }

    return json({ ok: true, clientId: client.id, bookingId: booking.id });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "Hire record could not be saved." }, 500);
  }
}
