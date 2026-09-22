import type { WeatherSnapshot } from "../../shared/types";
export { createWeatherSnapshot } from "../../shared/mockData";

export function weatherParticles(mode: WeatherSnapshot["mode"]): { rainIntensity: number; cloudOpacity: number; sunStrength: number } {
  if (mode === "storm") {
    return { rainIntensity: 1, cloudOpacity: 0.96, sunStrength: 0.15 };
  }
  if (mode === "rain") {
    return { rainIntensity: 0.72, cloudOpacity: 0.82, sunStrength: 0.24 };
  }
  if (mode === "cloudy") {
    return { rainIntensity: 0, cloudOpacity: 0.56, sunStrength: 0.44 };
  }
  return { rainIntensity: 0, cloudOpacity: 0.18, sunStrength: 1 };
}
