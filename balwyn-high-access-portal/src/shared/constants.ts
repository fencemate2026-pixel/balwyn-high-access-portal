export const BRAND_COLORS = {
  navy: "#0f2a47",
  dark: "#0f1b2d",
  accentBlue: "#0099ff",
  ledRed: "#ff3b2f",
  ledGreen: "#2ee05a",
  ledAmber: "#ffab1a",
  surface: "#e9edf2",
} as const;

export const NAV_ITEMS = [
  { path: "/", label: "Portal", description: "3D campus and live operations" },
  { path: "/admin", label: "Admin", description: "Rules, schedules, and AI" },
  { path: "/reports", label: "Reports", description: "Incidents and trend summaries" },
  { path: "/settings", label: "Settings", description: "Hardware and deployment notes" },
] as const;

export const CAMPUS_ZONES = [
  "North Entry",
  "Sports Precinct",
  "Service Lane",
  "Admin Forecourt",
  "Performing Arts",
] as const;

export const API_BASE = "/api/v1";
export const DEFAULT_OPERATOR = "Balwyn Control Room";
export const WEATHER_LABELS = {
  clear: "Clear sky",
  cloudy: "Cloud cover",
  rain: "Rainfront",
  storm: "Storm cell",
} as const;
