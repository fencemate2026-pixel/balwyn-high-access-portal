// Fake Mildura mirror data for the dev-only preview page. Invented names; no PINs.
const FIRST = ["Alex", "Sam", "Chris", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Pat", "Lee", "Drew"];
const LAST = ["Nguyen", "Smith", "Brown", "Wilson", "Taylor", "Martin", "Lee", "Walker", "Hall"];
export function milduraFixture(now = Date.now()) {
  const users = Array.from({ length: 97 }, (_, i) => ({ local_id: i + 1, name: `${FIRST[i % 12]} ${LAST[i % 9]}${i >= 60 ? ` ${i}` : ""}`, enabled: i % 11 !== 0,
    schedule_type: i % 7 === 0 ? "time_range" : "always", schedule_data: i % 7 === 0 ? JSON.stringify({ days: [0, 1, 2, 3, 4], start: "08:00", end: "17:00" }) : null, created_at_local: `2026-0${1 + (i % 9)}-1${i % 9} 10:00:00` }));
  const access30 = Array.from({ length: 420 }, (_, i) => {
    const t = new Date(now - (i * 30 * 86400_000) / 420 - 3600_000 * 11).toISOString().replace("T", " ").slice(0, 19);
    return { local_id: 5000 - i, occurred_at_local: t, user_name: i % 9 === 0 ? null : users[i % 97].name, method: i % 13 === 0 ? "auto_open" : "keypad", success: i % 9 !== 0 };
  });
  return {
    site: { id: "fixture", slug: "mildura", name: "Mildura Working Men's Club" },
    units: [{ id: "u1", name: "Boom gate", last_seen: new Date(now - 20_000).toISOString(), fw_version: "mirror-1.0",
      last_status: { lockdown: false, software_access_paused: false, gate_position: "closed", health: { board_temp_c: 48.3, cpu_percent: 7, memory_percent: 31, disk_percent: 42, uptime_s: 1_123_200 } } }],
    users, access30, access: access30.slice(0, 60),
    schedules: [{ local_id: 1, name: "Club open", days: [0, 1, 2, 3, 4], open_time: "10:00:00", close_time: "23:00:00", enabled: true },
      { local_id: 2, name: "Weekend", days: [5, 6], open_time: "09:00:00", close_time: "23:30:00", enabled: true }],
    persons: [{ local_id: 1, name: "Club Manager", role: "Manager" }, { local_id: 2, name: "Jarrod Alebakis", role: "RJL Electrical" }],
    changes: [{ local_id: 1, occurred_at_local: "2026-11-03 09:12:00", action: "user.add", detail: "Added Sam Smith", changed_by: "admin" }],
    serverTime: new Date(now).toISOString(),
  };
}

/** Phase 2 preview: unlocked, key registered, a few commands in each state. Invented; no PINs. */
export function milduraControlFixture(now = Date.now()) {
  const at = (s: number) => new Date(now - s * 1000).toISOString();
  return {
    keyRegistered: true, keyFingerprint: "3f9c2a71d04be6a85c11e0d7b2f4a9e6c3d8b17f20a5e9c4d6b3a1f7e8c2d905",
    unlocked: true, unlockExpiresAt: now + 8 * 60_000,
    gate: { open: true, lockdown: true, lockdownOn: false, hold: false as const, holdNote: "Hold Open is retired: the time clock controls hold.", offNote: "Gate actions are not enabled on the Mildura Pi." },
    commands: [
      { id: "f1", kind: "user.enable", args: { local_id: 12, enabled: false }, status: "pending" as const, created_at: at(4) },
      { id: "f2", kind: "user.add", args: { name: "Riley Walker", enabled: true, schedule_type: "always" }, status: "delivered" as const, created_at: at(9) },
      { id: "f3", kind: "schedule.enable", args: { local_id: 2, enabled: true }, status: "applied" as const, created_at: at(300) },
      { id: "f4", kind: "user.add", args: { name: "Pat Hall" }, status: "failed" as const, error: "that PIN is already in use", created_at: at(900) },
    ],
  };
}
