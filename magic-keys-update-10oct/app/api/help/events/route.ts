import { requireOperator } from "@/lib/portal-auth";
import { listHelpEvents } from "@/lib/help-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOperator(request, "administrator");
  if (!auth.user) return auth.response;
  try {
    const events = await listHelpEvents(80);
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.warn("help_events_unavailable");
    return Response.json({
      events: [],
      error: "Help questions are not available right now.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
