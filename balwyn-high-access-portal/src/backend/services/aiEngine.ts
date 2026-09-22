import type { AIInsight, GateStatus, ScheduleRule, WeatherSnapshot } from "../../shared/types.ts";

export function buildInsights(gates: GateStatus[], schedules: ScheduleRule[], weather: WeatherSnapshot): AIInsight[] {
  const issues = gates.filter((gate) => gate.status === "issue");
  const moving = gates.filter((gate) => gate.status === "moving");
  const insights: AIInsight[] = [];

  if (issues.length > 0) {
    insights.push({
      id: "issue-cluster",
      title: "Investigate active faults",
      summary: `${issues.length} gate controller${issues.length > 1 ? "s" : ""} are reporting issue states.`,
      priority: "high",
      recommendation: "Dispatch a patrol and switch the affected zone to supervised mode.",
      confidence: 0.94,
      affectedGateIds: issues.map((gate) => gate.id),
    });
  }

  if (weather.mode === "rain" || weather.mode === "storm") {
    insights.push({
      id: "weather-operations",
      title: "Weather-sensitive sequencing",
      summary: `Weather mode is ${weather.mode}; consider reducing dwell time on exposed gates.`,
      priority: weather.mode === "storm" ? "high" : "medium",
      recommendation: "Enable anti-tailgate timing and verify camera housings are dry.",
      confidence: 0.88,
      affectedGateIds: gates.map((gate) => gate.id),
    });
  }

  if (moving.length > 0) {
    insights.push({
      id: "moving-balance",
      title: "Smooth gate turnover",
      summary: `${moving.length} asset${moving.length > 1 ? "s are" : " is"} transitioning between positions.`,
      priority: "low",
      recommendation: `Review ${schedules.length} scheduled rules to reduce overlap windows.`,
      confidence: 0.71,
      affectedGateIds: moving.map((gate) => gate.id),
    });
  }

  return insights;
}
