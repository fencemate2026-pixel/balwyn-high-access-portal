import type { ActivityRecord } from "@/lib/portal-types";

export function createTimestamp() {
  return new Date().toISOString();
}

export function formatMelbourneTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(timestamp));
}

export function buildActivityRecord(
  action: string,
  detail: string,
  options: { timestamp?: string; source?: string } = {},
): ActivityRecord {
  const timestamp = options.timestamp ?? createTimestamp();
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    action,
    detail,
    time: formatMelbourneTime(timestamp),
    timestamp,
    source: options.source,
  };
}
