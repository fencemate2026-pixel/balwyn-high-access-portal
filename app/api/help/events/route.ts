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
    return Response.json({
      events: [],
      error: "help_events is not available yet. Apply supabase/migrations/20260924210000_help_events.sql.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
