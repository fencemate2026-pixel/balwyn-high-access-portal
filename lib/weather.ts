export type WeatherPlace = { latitude: string; longitude: string; timezone: string };
const BALWYN: WeatherPlace = { latitude: "-37.8112", longitude: "145.0774", timezone: "Australia/Melbourne" };
/** Suburb forecast for the Macquarie Drive resident portal. Not a sensor on the gate. */
export const THOMASTOWN_PLACE: WeatherPlace = { latitude: "-37.6802", longitude: "145.0144", timezone: "Australia/Melbourne" };
const TTL = 10 * 60_000;
const MAX_AGE = 60 * 60_000;
const labels: Record<string, string> = { sun: "Clear", "sun-cloud": "Partly cloudy", cloud: "Cloudy", rain: "Rain", storm: "Thunderstorms", snow: "Snow" };
const finite = (n: unknown): number | null => typeof n === "number" && Number.isFinite(n) ? n : null;
function icon(code: number) {
  if (code <= 1) return "sun";
  if (code === 2) return "sun-cloud";
  if (code >= 95) return "storm";
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return "snow";
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "rain";
  return "cloud";
}
type Day = { date: string; icon: string; label: string; max: number | null; min: number | null };
export type Weather = {
  source: string; updatedAt: string; stale: boolean;
  current: { temp: number | null; icon: string; label: string; wind: number | null; humidity: number | null; /** Today's highest hourly chance of rain, %. null when the provider does not supply it. */ rainChance: number | null };
  days: Day[];
};
type Meteo = { current?: Record<string, number>; daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[] } };
type Point = { time: string; data: { instant: { details: Record<string, number> }; next_1_hours?: { summary: { symbol_code: string } }; next_6_hours?: { summary: { symbol_code: string } }; next_12_hours?: { summary: { symbol_code: string } } } };
function metIcon(point: Point) {
  const symbol = (point.data.next_1_hours ?? point.data.next_6_hours ?? point.data.next_12_hours)?.summary.symbol_code ?? "cloudy";
  return /thunder/.test(symbol) ? "storm" : /snow|sleet/.test(symbol) ? "snow" : /rain/.test(symbol) ? "rain" : /partly|fair/.test(symbol) ? "sun-cloud" : /clearsky/.test(symbol) ? "sun" : "cloud";
}

/** Cache and deduplicate provider calls for all operators on this app instance. */
export function createWeatherService(fetcher: typeof fetch = fetch, now = Date.now, place: WeatherPlace = BALWYN) {
  let cached: Weather | null = null;
  let expires = 0;
  let retryAfter = 0;
  let pending: Promise<Weather> | null = null;
  async function refresh(): Promise<Weather> {
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({ ...place, current: "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m", daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max", forecast_days: "7" }).toString();
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Primary forecast unavailable");
      const body = await response.json() as Meteo;
      if (finite(body.current?.temperature_2m) === null || !body.daily?.time?.length) throw new Error("Incomplete forecast");
      const kind = icon(body.current?.weather_code ?? 3);
      const result: Weather = { source: "Open-Meteo", updatedAt: new Date(now()).toISOString(), stale: false,
        current: { temp: finite(body.current?.temperature_2m), icon: kind, label: labels[kind], wind: finite(body.current?.wind_speed_10m), humidity: finite(body.current?.relative_humidity_2m), rainChance: finite(body.daily?.precipitation_probability_max?.[0]) },
        days: body.daily.time.map((date, i) => { const kind = icon(body.daily?.weather_code?.[i] ?? 3); return { date, icon: kind, label: labels[kind], max: finite(body.daily?.temperature_2m_max?.[i]), min: finite(body.daily?.temperature_2m_min?.[i]) }; }),
      };
      expires = now() + TTL;
      return result;
    } catch {
      const response = await fetcher(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${place.latitude}&lon=${place.longitude}`, {
        headers: { "User-Agent": "MagicKeysBalwyn/1.0 (https://rjlcommercialgroup.com)", Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error("Fallback forecast unavailable");
      const body = await response.json() as { properties?: { timeseries?: Point[] } };
      const points = (body.properties?.timeseries ?? []).filter(p => Date.parse(p.time) >= now() - 3600_000 && finite(p.data?.instant?.details?.air_temperature) !== null);
      if (!points.length) throw new Error("Incomplete fallback forecast");
      const first = points[0]; const details = first.data.instant.details; const kind = metIcon(first);
      const groups = new Map<string, Point[]>();
      for (const point of points) {
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: place.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(point.time));
        groups.set(date, [...(groups.get(date) ?? []), point]);
      }
      expires = Math.max(now() + TTL, Date.parse(response.headers.get("expires") ?? "") || 0);
      return { source: "MET Norway", updatedAt: new Date(now()).toISOString(), stale: false,
        current: { temp: finite(details.air_temperature), icon: kind, label: labels[kind], wind: finite(details.wind_speed) === null ? null : details.wind_speed * 3.6, humidity: finite(details.relative_humidity), rainChance: null },
        days: [...groups].slice(0, 7).map(([date, samples]) => { const kind = metIcon(samples[Math.floor(samples.length / 2)]); const temps = samples.map(p => p.data.instant.details.air_temperature); return { date, icon: kind, label: `${labels[kind]} · range across remaining forecast hours`, max: Math.max(...temps), min: Math.min(...temps) }; }),
      };
    }
  }
  return async function getWeather(): Promise<Weather> {
    const usable = cached && now() - Date.parse(cached.updatedAt) < MAX_AGE;
    if (usable && now() < expires) return cached!;
    if (now() < retryAfter) {
      if (usable) return { ...cached!, stale: true };
      throw new Error("Forecast temporarily unavailable");
    }
    if (!pending) pending = refresh().then(result => { cached = result; retryAfter = 0; return result; }).catch(() => {
      retryAfter = now() + 60_000;
      if (cached && now() - Date.parse(cached.updatedAt) < MAX_AGE) return { ...cached, stale: true };
      throw new Error("Forecast temporarily unavailable");
    }).finally(() => { pending = null; });
    return pending;
  };
}
export const getBalwynWeather = createWeatherService();
export const getThomastownWeather = createWeatherService(fetch, Date.now, THOMASTOWN_PLACE);
