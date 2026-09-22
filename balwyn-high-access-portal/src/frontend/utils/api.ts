import { API_BASE, DEFAULT_OPERATOR } from "../../shared/constants";
import type { AccessRule, AIInsight, DashboardSnapshot, EmergencyState, GateStatus, HireBooking, PortalSnapshot, ScheduleRule, WeatherSnapshot } from "../../shared/types";
export { createFallbackSnapshot } from "../../shared/mockData";
import { createFallbackSnapshot } from "../../shared/mockData";

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "x-portal-role": "admin",
      "x-operator-name": DEFAULT_OPERATOR,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}`);
  }

  const payload = (await response.json()) as { data: T };
  return payload.data;
}

export async function loadPortalSnapshot(signal?: AbortSignal): Promise<{ snapshot: PortalSnapshot; source: "api" | "fallback" }> {
  const fallback = createFallbackSnapshot();
  try {
    const [gates, dashboard, accessRules, schedules, insights, weather, emergency, hireBookings] = await Promise.all([
      fetchJson<GateStatus[]>("/gates", signal),
      fetchJson<DashboardSnapshot>("/scheduler/dashboard", signal),
      fetchJson<AccessRule[]>("/access/rules", signal),
      fetchJson<ScheduleRule[]>("/scheduler/rules", signal),
      fetchJson<AIInsight[]>("/ai/insights", signal),
      fetchJson<WeatherSnapshot>("/ai/weather", signal),
      fetchJson<EmergencyState>("/gates/emergency", signal),
      fetchJson<HireBooking[]>("/hire", signal),
    ]);

    return {
      source: "api",
      snapshot: { gates, dashboard, accessRules, schedules, insights, weather, emergency, hireBookings },
    };
  } catch {
    return { source: "fallback", snapshot: fallback };
  }
}

export async function sendEmergencyAction(action: "lockdown" | "fire" | "normal"): Promise<EmergencyState> {
  try {
    const response = await fetch(`${API_BASE}/gates/emergency`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portal-role": "admin",
        "x-operator-name": DEFAULT_OPERATOR,
      },
      body: JSON.stringify({ action }),
    });

    if (!response.ok) {
      throw new Error("Emergency update failed");
    }

    const payload = (await response.json()) as { data: EmergencyState };
    return payload.data;
  } catch {
    const fallback = createFallbackSnapshot().emergency;
    if (action === "normal") {
      return fallback;
    }
    return {
      ...fallback,
      mode: action === "fire" ? "fire" : "lockdown",
      lockdownActive: action === "lockdown",
      fireAlarmActive: action === "fire",
      updatedAt: new Date().toISOString(),
    };
  }
}
