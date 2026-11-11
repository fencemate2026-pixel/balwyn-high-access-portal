import { getThomastownWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getThomastownWeather(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Thomastown forecast is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
