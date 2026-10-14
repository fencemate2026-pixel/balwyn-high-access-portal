// Heartbeat from the signed-in portal page: adds server-measured time on the
// portal and the labels of buttons pressed since the last beat (15 Oct 2026).
// Any signed-in role may send one; it only ever records for the caller's own
// session. Failures are silent to the page: this must never disturb gate use.
import { assertSameOrigin, requireOperator } from "@/lib/portal-auth";
import { readBoundedText } from "@/lib/request-body";
import { recordHeartbeat } from "@/lib/staff-presence";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403, headers });
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  let body: Record<string, unknown>;
  try {
    const raw = await readBoundedText(request, 16384);
    if (raw === null) return Response.json({ error: "Invalid request." }, { status: 413, headers });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  try {
    const result = await recordHeartbeat(auth.user, { sessionId: body.sessionId, events: body.events });
    return Response.json({ ok: result.counted }, { headers });
  } catch {
    console.warn("presence_unavailable");
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
