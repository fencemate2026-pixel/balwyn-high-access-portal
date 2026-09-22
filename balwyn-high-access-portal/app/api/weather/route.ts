import { requireOperator } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

function iconFor(code: number) {
  if (code === 0 || code === 1) return "sun";
  if (code === 2) return "sun-cloud";
  if (code === 3 || code === 45 || code === 48) return "cloud";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 95) return "storm";
  if (code >= 71 && code <= 77) return "snow";
  return "cloud";
}

const LABELS: Record<string, string> = {
  sun: "Clear", "sun-cloud": "Partly cloudy", cloud: "Cloudy", rain: "Rain", storm: "Thunder", snow: "Snow",
};

export async function GET(request: Request) {
  const auth = await requireOperator(request, "viewer");
  if (!auth.user) return auth.response;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", "-37.8094");
  url.searchParams.set("longitude", "145.0835");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
  url.searchParams.set("timezone", "Australia/Melbourne");
  url.searchParams.set("forecast_days", "7");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Balwyn forecast is unavailable." }, { status: 503 });
  const body = await response.json() as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      wind_speed_10m_max?: number[];
    };
  };
  const days = (body.daily?.time ?? []).map((date, index) => {
    const code = body.daily?.weather_code?.[index] ?? 3;
    const icon = iconFor(code);
    return {
      date,
      code,
      icon,
      label: LABELS[icon],
      max: body.daily?.temperature_2m_max?.[index] ?? null,
      min: body.daily?.temperature_2m_min?.[index] ?? null,
      rain: body.daily?.precipitation_probability_max?.[index] ?? null,
      wind: body.daily?.wind_speed_10m_max?.[index] ?? null,
    };
  });
  return Response.json({ place: "Balwyn, Melbourne", timezone: "Australia/Melbourne", source: "open-meteo", days }, { headers: { "Cache-Control": "no-store" } });
}
