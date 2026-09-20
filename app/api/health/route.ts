// Process health only; this endpoint does not seed data or issue commands.
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
