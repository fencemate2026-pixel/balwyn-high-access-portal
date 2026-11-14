import { getSql } from "@/db";
import { classroomPayload } from "@/lib/classroom-guidance";

export const dynamic = "force-dynamic";

/** Public read for classroom projectors. Returns the route, or standby. Nothing else. */
export async function GET() {
  try {
    const row = await getSql()
      .prepare("SELECT mode, updated_at FROM system_state WHERE id = 1")
      .first<{ mode: string; updated_at: string }>();
    return Response.json(classroomPayload(row?.mode, row?.updated_at ?? null), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("classroom guidance failed", error);
    return Response.json(
      { error: "The classroom screen is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
