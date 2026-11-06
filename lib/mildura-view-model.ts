/**
 * Mildura read-only view (4 Nov 2026) — pure shaping of the gd_mirror_* rows the
 * owner route returns. No I/O or controls. entered_pin is an optional actual event value.
 */
export type MirrorAccess = { local_id?: number; occurred_at_local: string; user_name: string | null; method: string | null; success: boolean | null; entered_pin?: string | null };
export type MirrorStatus = Record<string, unknown> | null;

export const MILDURA_ADDRESS = "100-110 Deakin Ave, Mildura VIC 3500";

/** Pi local times are naive Melbourne wall-clock strings; the day is the first 10 chars. */
export function dayKey(ts: string) { return String(ts).slice(0, 10); }

export function isAutoOpen(a: Pick<MirrorAccess, "method">) { return /auto|schedule/i.test(a.method ?? ""); }

/** Granted / denied / auto-open counts, as on the Pi's access breakdown donut. */
export function accessBreakdown(rows: Pick<MirrorAccess, "method" | "success">[]) {
  const out = { granted: 0, denied: 0, autoOpen: 0 };
  for (const r of rows) {
    if (isAutoOpen(r)) out.autoOpen++;
    else if (r.success) out.granted++;
    else out.denied++;
  }
  return out;
}

/** 30 daily buckets ending on `today` (YYYY-MM-DD), keypad uses only (not auto-open). */
export function usageByDay(rows: Pick<MirrorAccess, "occurred_at_local" | "method">[], today: string, days = 30) {
  const end = Date.parse(`${today}T00:00:00Z`);
  const buckets = Array.from({ length: days }, (_, i) => ({ day: new Date(end - (days - 1 - i) * 86400_000).toISOString().slice(0, 10), count: 0 }));
  const idx = new Map(buckets.map((b, i) => [b.day, i]));
  for (const r of rows) {
    if (isAutoOpen(r)) continue;
    const i = idx.get(dayKey(r.occurred_at_local));
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Pi health tiles from last_status (top level or under health/system). Missing → null ("not reported"). */
export function healthTiles(status: MirrorStatus) {
  const s = (status ?? {}) as Record<string, unknown>;
  const h = { ...s, ...((s.system ?? {}) as object), ...((s.health ?? {}) as object) } as Record<string, unknown>;
  const pick = (...keys: string[]) => { for (const k of keys) { const v = num(h[k]); if (v !== null) return v; } return null; };
  const up = pick("uptime_s", "uptime_seconds", "uptime");
  const pct = (v: number | null) => (v === null ? null : `${Math.round(v)}%`);
  const t = pick("board_temp_c", "board_temp", "cpu_temp_c", "cpu_temp", "temp_c", "temperature");
  return [
    { key: "temp", label: "Board temp", value: t === null ? null : `${t.toFixed(1)} °C` },
    { key: "cpu", label: "CPU", value: pct(pick("cpu_percent", "cpu_pct", "cpu")) },
    { key: "mem", label: "Memory", value: pct(pick("memory_percent", "mem_percent", "memory", "mem")) },
    { key: "disk", label: "Disk", value: pct(pick("disk_percent", "disk")) },
    { key: "uptime", label: "Uptime", value: up === null ? null : up >= 86400 ? `${Math.floor(up / 86400)} d ${Math.floor((up % 86400) / 3600)} h` : `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min` },
  ];
}

/** Gate status line from the Pi's own /api/status fields the mirror forwards. */
export function gateStatus(status: MirrorStatus) {
  const s = (status ?? {}) as Record<string, unknown>;
  if (s.lockdown === true) return { label: "Lockdown", tone: "bad" as const };
  if (s.software_access_paused === true) return { label: "Access paused", tone: "warn" as const };
  if (s.auto_open === true) return { label: typeof s.auto_name === "string" && s.auto_name ? `Auto-open: ${s.auto_name}` : "Auto-open window", tone: "warn" as const };
  if (s.manual_hold === true) return { label: "Manual hold on", tone: "warn" as const };
  const pos = typeof s.gate_position === "string" ? s.gate_position : null;
  if (pos) return { label: pos.charAt(0).toUpperCase() + pos.slice(1).replace(/_/g, " "), tone: /open/i.test(pos) ? "warn" as const : "ok" as const };
  return { label: "Not reported", tone: "mute" as const };
}
