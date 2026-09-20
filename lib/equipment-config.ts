export type EquipmentConfig = {
  remoteOpenEnabled: boolean;
  gateMap: Record<string, number> | null;
  refreshSeconds: number;
  voiceRate: number;
  voiceVolume: number;
  pi: { pulseMs: number; pins: number[]; activeLow: boolean; mode: "mock" | "dry-run" | "hardware"; chip: number };
};
export const DEFAULT_EQUIPMENT: EquipmentConfig = {
  remoteOpenEnabled: true, gateMap: null, refreshSeconds: 10, voiceRate: 1, voiceVolume: 1,
  pi: { pulseMs: 500, pins: [17, 27, 22, 23], activeLow: true, mode: "mock", chip: 0 },
};
export function validateEquipment(value: unknown, gates: readonly { id: string }[]): EquipmentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid equipment settings");
  const v = value as EquipmentConfig;
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (typeof v.remoteOpenEnabled !== "boolean" || !integer(v.refreshSeconds, 5, 60) ||
    !Number.isFinite(v.voiceRate) || v.voiceRate < 0.5 || v.voiceRate > 1.5 ||
    !Number.isFinite(v.voiceVolume) || v.voiceVolume < 0 || v.voiceVolume > 1) throw new Error("Invalid display or announcement settings");
  if (v.gateMap !== null) {
    if (!v.gateMap || typeof v.gateMap !== "object" || Array.isArray(v.gateMap)) throw new Error("Invalid door mapping");
    const entries = Object.entries(v.gateMap);
    if (entries.length > 4 || new Set(entries.map(([,n]) => n)).size !== entries.length || entries.some(([id,n]) => !gates.some(g => g.id === id) || !integer(n,1,4))) throw new Error("Map each Compass channel to one registered gate only");
  }
  const pi = v.pi;
  if (!pi || !integer(pi.pulseMs,300,10000) || !Array.isArray(pi.pins) || pi.pins.length !== 4 || new Set(pi.pins).size !== 4 || pi.pins.some(n => !integer(n,2,27)) || typeof pi.activeLow !== "boolean" || !["mock","dry-run","hardware"].includes(pi.mode) || !integer(pi.chip,0,8)) throw new Error("Invalid Pi relay configuration");
  return { remoteOpenEnabled:v.remoteOpenEnabled, gateMap:v.gateMap === null ? null : {...v.gateMap}, refreshSeconds:v.refreshSeconds, voiceRate:v.voiceRate, voiceVolume:v.voiceVolume, pi:{pulseMs:pi.pulseMs,pins:[...pi.pins],activeLow:pi.activeLow,mode:pi.mode,chip:pi.chip} };
}
export function exportPiConfiguration(config: EquipmentConfig) {
  return ["# Apply on the Pi after verifying the connected relay channels.", "# Exporting or saving this file does not update a running Pi.", "# Keep the existing DOOR_API_TOKEN and DOOR_JOURNAL values.",
    `DOOR_MODE=${config.pi.mode}`, `DOOR_PULSE_MS=${config.pi.pulseMs}`, `DOOR_GPIO_PINS=${config.pi.pins.join(",")}`,
    `DOOR_ACTIVE_LOW=${config.pi.activeLow}`, `DOOR_GPIO_CHIP=${config.pi.chip}`, ""].join("\n");
}
