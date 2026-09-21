import { requireOperator } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const BALWYN = { latitude: -37.8094, longitude: 145.0835, label: "Balwyn" };

const CODES: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Cloudy",
  45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
  61: "Rain", 63: "Rain", 65: "Heavy rain", 71: "Snow", 80: "Showers",
  81: "Showers", 82: "Heavy showers", 95: "Thunder",
};

export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(BALWYN.latitude));
  url.searchParams.set("longitude", String(BALWYN.longitude));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "Australia/Melbourne");
  url.searchParams.set("forecast_days", "7");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return Response.json({ error: "Balwyn forecast is unavailable." }, { status: 503 });
  }
  const body = await response.json() as {
    daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const days = (body.daily?.time ?? []).map((date, index) => ({
    date,
    code: body.daily?.weather_code?.[index] ?? null,
    label: CODES[body.daily?.weather_code?.[index] ?? -1] || "Forecast",
    max: body.daily?.temperature_2m_max?.[index] ?? null,
    min: body.daily?.temperature_2m_min?.[index] ?? null,
  }));
  return Response.json({
    place: "Balwyn, Melbourne",
    timezone: "Australia/Melbourne",
    source: "open-meteo",
    days,
  }, { headers: { "Cache-Control": "no-store" } });
}
