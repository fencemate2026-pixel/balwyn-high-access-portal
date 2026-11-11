import { requireOperator } from "@/lib/portal-auth";
import { getBalwynWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  try {
    return Response.json(await getBalwynWeather(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "The forecast is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
