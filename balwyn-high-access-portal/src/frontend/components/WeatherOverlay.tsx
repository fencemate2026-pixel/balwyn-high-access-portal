import { WEATHER_LABELS } from "../../shared/constants";
import type { WeatherSnapshot } from "../../shared/types";

interface WeatherOverlayProps {
  weather: WeatherSnapshot;
}

export function WeatherOverlay({ weather }: WeatherOverlayProps){
  return (
    <div className="weather-overlay">
      <div>
        <span className="eyebrow">Weather layer</span>
        <strong>{WEATHER_LABELS[weather.mode]}</strong>
        <p>{weather.summary}</p>
      </div>
      <dl>
        <div>
          <dt>Temp</dt>
          <dd>{weather.temperatureC}°C</dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>{weather.windKph} km/h</dd>
        </div>
        <div>
          <dt>Rain</dt>
          <dd>{weather.rainChance}%</dd>
        </div>
      </dl>
    </div>
  );
}
