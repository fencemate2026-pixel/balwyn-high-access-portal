/**
 * Mildura boom gate - Azure "gd" schema data access (7 Nov 2026, Jarrod: move Mildura off Supabase).
 * Server-only. Replaces the Supabase gd-mirror function (deploy/mildura/cloud/gd-mirror.index.ts.txt) with the
 * SAME wire protocol, so the Pi (deploy/mildura/pi/mildura_mirror.py) only needs its MIRROR_URL changed.
 *
 * Every function takes the transaction client, so the routes own transaction boundaries and the tests run the
 * real SQL (deploy/azure/gd/003_mildura.sql) on PostgreSQL semantics (PGlite).
 *
 * Secrets: the device secret is never stored, only its sha256 (gd.devices.secret_sha256). PINs and phone numbers
 * in commands are only ever RSA-OAEP ciphertext sealed to the Pi's own key (column sealed), wiped when the
 * command finishes. The PIN typed at an access event (owner request, 6 Nov 2026) lives only in mildura_access_pins.
 */
import type { GdClient } from "@/lib/gd-db";
import { env } from "@/lib/server-env";

export const MILDURA_DEVICE_ID = "mildura-001";
export const MILDURA_SLUG = "mildura";
export const MILDURA_NAME = "Mildura Working Men's Club";
/** Mildura reads and writes Azure only when this App Service setting is "azure"; anything else keeps the old Supabase path. */
export const milduraOnAzure = () => String(env.MILDURA_BACKEND ?? "").trim().toLowerCase() === "azure";

const MAX_ROWS = 500;
const COMMAND_COLUMNS = "id, seq::int AS seq, kind, args, status, actor_email, error, result, created_at, finished_at";
const str = (v: unknown, n = 500): string | null => (v == null ? null : String(v).slice(0, n));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const num = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) > 0 ? v as number : null);
type Row = Record<string, unknown>;
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.slice(0, MAX_ROWS).filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r)) : []);
/** Rows with a valid Pi id, one per id (a duplicate id inside one batch would make the upsert fail). */
function byId(v: unknown): Row[] {
  const m = new Map<number, Row>();
  for (const r of rowsOf(v)) { const id = num(r.id); if (id) m.set(id, r); }
  return [...m.values()];
}

// ---- Device side (Pi -> Azure) ---------------------------------------------------------------
export type MilduraUnit = { device_id: string; secret_sha256: string | null; command_pubkey: string | null };

export async function findUnit(c: GdClient, device: string): Promise<MilduraUnit | null> {
  const r = await c.query("SELECT device_id, secret_sha256, command_pubkey FROM gd.devices WHERE device_id = $1", [device]);
  return (r.rows[0] as MilduraUnit | undefined) ?? null;
}

/** Heartbeat first, in its own transaction, so last_seen stays fresh even if a table write fails afterwards. */
export async function heartbeat(c: GdClient, device: string, status: unknown, fw: unknown) {
  const s = status && typeof status === "object" && !Array.isArray(status) ? JSON.stringify(status) : null;
  await c.query("UPDATE gd.devices SET last_seen = now(), last_status = COALESCE($2::jsonb, last_status), fw_version = COALESCE($3, fw_version) WHERE device_id = $1",
    [device, s, str(fw, 40)]);
}

/** Store what the Pi sent. Snapshot tables are full copies (rows the Pi no longer has are removed); logs are keyed by the Pi's own id. */
export async function applyPush(c: GdClient, device: string, b: Row): Promise<void> {
  const sn = (b.snapshots && typeof b.snapshots === "object" ? b.snapshots : {}) as Row;
  const st = (b.streams && typeof b.streams === "object" ? b.streams : {}) as Row;

  const users = byId(sn.users).map((r) => ({ local_id: r.id, name: str(r.name, 200) ?? "", enabled: bool(r.enabled), schedule_type: str(r.schedule_type, 40), schedule_data: str(r.schedule_data, 2000), created_at_local: str(r.created_at, 40) }));
  if (users.length) {
    await c.query(
      `INSERT INTO gd.mildura_users(device_id,local_id,name,enabled,schedule_type,schedule_data,created_at_local,synced_at)
       SELECT $1, x.local_id, x.name, x.enabled, x.schedule_type, x.schedule_data, x.created_at_local, now()
       FROM jsonb_to_recordset($2::jsonb) AS x(local_id bigint, name text, enabled boolean, schedule_type text, schedule_data text, created_at_local text)
       ON CONFLICT (device_id,local_id) DO UPDATE SET name=EXCLUDED.name, enabled=EXCLUDED.enabled, schedule_type=EXCLUDED.schedule_type,
         schedule_data=EXCLUDED.schedule_data, created_at_local=EXCLUDED.created_at_local, synced_at=now()`, [device, JSON.stringify(users)]);
  }
  const schedules = byId(sn.auto_schedules).map((r) => ({ local_id: r.id, name: str(r.name, 200), days: str(r.days, 100), open_time: str(r.open_time, 10), close_time: str(r.close_time, 10), enabled: bool(r.enabled) }));
  if (schedules.length) {
    await c.query(
      `INSERT INTO gd.mildura_schedules(device_id,local_id,name,days,open_time,close_time,enabled,synced_at)
       SELECT $1, x.local_id, x.name, x.days, x.open_time, x.close_time, x.enabled, now()
       FROM jsonb_to_recordset($2::jsonb) AS x(local_id bigint, name text, days text, open_time text, close_time text, enabled boolean)
       ON CONFLICT (device_id,local_id) DO UPDATE SET name=EXCLUDED.name, days=EXCLUDED.days, open_time=EXCLUDED.open_time,
         close_time=EXCLUDED.close_time, enabled=EXCLUDED.enabled, synced_at=now()`, [device, JSON.stringify(schedules)]);
  }
  const persons = byId(sn.auth_persons).map((r) => ({ local_id: r.id, name: str(r.name, 200), role: str(r.role, 100) }));
  if (persons.length) {
    await c.query(
      `INSERT INTO gd.mildura_persons(device_id,local_id,name,role,synced_at)
       SELECT $1, x.local_id, x.name, x.role, now()
       FROM jsonb_to_recordset($2::jsonb) AS x(local_id bigint, name text, role text)
       ON CONFLICT (device_id,local_id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, synced_at=now()`, [device, JSON.stringify(persons)]);
  }

  const access = byId(st.access_log);
  if (access.length) {
    await c.query(
      `INSERT INTO gd.mildura_access(device_id,local_id,occurred_at_local,user_name,method,success)
       SELECT $1, x.local_id, x.occurred_at_local, x.user_name, x.method, x.success
       FROM jsonb_to_recordset($2::jsonb) AS x(local_id bigint, occurred_at_local text, user_name text, method text, success boolean)
       ON CONFLICT (device_id,local_id) DO UPDATE SET occurred_at_local=EXCLUDED.occurred_at_local, user_name=EXCLUDED.user_name, method=EXCLUDED.method, success=EXCLUDED.success`,
      [device, JSON.stringify(access.map((r) => ({ local_id: r.id, occurred_at_local: str(r.timestamp, 40), user_name: str(r.user_name, 200), method: str(r.method, 40), success: bool(r.success) })))]);
    // Only the actual recorded attempt is accepted. Written after the access rows so the composite foreign key exists.
    const pins = access.filter((r) => typeof r.attempted_pin === "string" && /^[0-9]{1,16}$/.test(r.attempted_pin)).map((r) => ({ local_id: r.id, attempted_pin: r.attempted_pin }));
    if (pins.length) {
      await c.query(
        `INSERT INTO gd.mildura_access_pins(device_id,local_id,attempted_pin)
         SELECT $1, x.local_id, x.attempted_pin FROM jsonb_to_recordset($2::jsonb) AS x(local_id bigint, attempted_pin text)
         ON CONFLICT (device_id,local_id) DO UPDATE SET attempted_pin=EXCLUDED.attempted_pin`, [device, JSON.stringify(pins)]);
    }
  }
  const changes = byId(st.changes_log);
  if (changes.length) {
    await c.query(
      `INSERT INTO gd.mildura_changes(device_id,local_id,occurred_at_local,action,detail,changed_by,source)
       SELECT $1, x.local_id, x.occurred_at_local, x.action, x.detail, x.changed_by, 'pi'
       FROM jsonb_to_recordset($2::jsonb) AS x(local_id bigint, occurred_at_local text, action text, detail text, changed_by text)
       ON CONFLICT (device_id,local_id) DO UPDATE SET occurred_at_local=EXCLUDED.occurred_at_local, action=EXCLUDED.action, detail=EXCLUDED.detail, changed_by=EXCLUDED.changed_by`,
      [device, JSON.stringify(changes.map((r) => ({ local_id: r.id, occurred_at_local: str(r.timestamp, 40), action: str(r.action, 80), detail: str(r.detail, 500), changed_by: str(r.changed_by, 120) })))]);
  }

  // Snapshot tables mirror deletions too. Skipped when the Pi sent a full page, so a truncated copy never wipes rows.
  for (const [table, key, ids] of [["mildura_users", "users", users], ["mildura_schedules", "auto_schedules", schedules], ["mildura_persons", "auth_persons", persons]] as const) {
    const sent = sn[key];
    if (Array.isArray(sent) && sent.length < MAX_ROWS) {
      await c.query(`DELETE FROM gd.${table} WHERE device_id = $1 AND NOT (local_id = ANY($2::bigint[]))`, [device, ids.map((r) => r.local_id)]);
    }
  }
}

const PEM = /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]{300,1200}\n-----END PUBLIC KEY-----\n?$/;
/** The Pi registers its RSA-OAEP PUBLIC key once (first write wins). Returns null for a malformed key. */
export async function registerKey(c: GdClient, device: string, pubkey: unknown): Promise<{ registered: boolean } | null> {
  const pem = typeof pubkey === "string" ? pubkey.replace(/\r/g, "") : "";
  if (!PEM.test(pem)) return null;
  const cur = (await c.query("SELECT command_pubkey FROM gd.devices WHERE device_id = $1 FOR UPDATE", [device])).rows[0]?.command_pubkey;
  if (typeof cur === "string" && cur) return { registered: cur.trim() === pem.trim() };
  await c.query("UPDATE gd.devices SET command_pubkey = $2, command_pubkey_at = now() WHERE device_id = $1 AND command_pubkey IS NULL", [device, pem]);
  return { registered: true };
}

/** Lazy expiry + housekeeping, then hand over open commands. Delivered ones are re-sent until acked (the Pi is idempotent). */
export async function takeCommands(c: GdClient, device: string) {
  await c.query("UPDATE gd.mildura_commands SET status='expired', sealed=NULL, finished_at=now(), error='expired before the Pi applied it' WHERE device_id=$1 AND status IN ('pending','delivered') AND expires_at < now()", [device]);
  await c.query("DELETE FROM gd.mildura_commands WHERE device_id=$1 AND created_at < now() - interval '30 days'", [device]);
  const r = await c.query(
    `UPDATE gd.mildura_commands SET status='delivered', delivered_at=now(), attempts=attempts+1
     WHERE id IN (SELECT id FROM gd.mildura_commands WHERE device_id=$1 AND status IN ('pending','delivered') ORDER BY seq LIMIT 20 FOR UPDATE)
     RETURNING id, seq::int AS seq, kind, args, sealed, actor_email, created_at`, [device]);
  return [...r.rows].sort((x, y) => Number(x.seq) - Number(y.seq));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The Pi reports results. Only an open command of THIS device can be finished, and the ciphertext is wiped with it. */
export async function ackCommands(c: GdClient, device: string, results: unknown) {
  for (const r of rowsOf(results).slice(0, 50)) {
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    const ok = r.ok === true;
    const rj = r.result && typeof r.result === "object" ? JSON.stringify(r.result) : "";
    await c.query(
      `UPDATE gd.mildura_commands SET status=$3, sealed=NULL, finished_at=now(), error=$4, result=$5::jsonb
       WHERE id=$1 AND device_id=$2 AND status IN ('pending','delivered')`,
      [r.id, device, ok ? "applied" : "failed", ok ? null : str(r.error, 300) ?? "rejected by the Pi", rj && rj.length <= 2000 ? rj : null]);
  }
}

// ---- Owner side (portal -> Azure). Same shapes the Supabase path returned, so the screens do not change. ----
export const milduraSite = () => ({ id: MILDURA_DEVICE_ID, slug: MILDURA_SLUG, name: MILDURA_NAME });

/** The owner's sidebar row, in the same shape as a Supabase gd_sites row. Null if the device row is missing. */
export async function siteRow(c: GdClient) {
  const r = (await c.query("SELECT last_seen, last_status FROM gd.devices WHERE device_id = $1", [MILDURA_DEVICE_ID])).rows[0];
  if (!r) return null;
  const status = (r.last_status ?? {}) as Row;
  return { ...milduraSite(), address: null, config_version: 1,
    gd_units: [{ id: MILDURA_DEVICE_ID, last_seen: r.last_seen ?? null, applied_version: 1, enabled: true, lockdown: status.lockdown === true }] };
}

export async function mirrorDetail(c: GdClient) {
  const d = MILDURA_DEVICE_ID, since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [units, users, schedules, persons, access, access30, changes] = await Promise.all([
    c.query("SELECT device_id AS id, site_name AS name, last_seen, last_status, fw_version FROM gd.devices WHERE device_id=$1", [d]),
    c.query("SELECT local_id::int AS local_id, name, enabled, schedule_type, schedule_data, created_at_local FROM gd.mildura_users WHERE device_id=$1 ORDER BY name LIMIT 2000", [d]),
    c.query("SELECT local_id::int AS local_id, name, days, open_time, close_time, enabled FROM gd.mildura_schedules WHERE device_id=$1 ORDER BY name", [d]),
    c.query("SELECT local_id::int AS local_id, name, role FROM gd.mildura_persons WHERE device_id=$1 ORDER BY name", [d]),
    c.query(`SELECT a.local_id::int AS local_id, a.occurred_at_local, a.user_name, a.method, a.success, p.attempted_pin AS entered_pin
             FROM gd.mildura_access a LEFT JOIN gd.mildura_access_pins p ON p.device_id=a.device_id AND p.local_id=a.local_id
             WHERE a.device_id=$1 ORDER BY a.occurred_at_local DESC, a.local_id DESC LIMIT 300`, [d]),
    c.query("SELECT occurred_at_local, method, success FROM gd.mildura_access WHERE device_id=$1 AND occurred_at_local >= $2 LIMIT 20000", [d, since]),
    c.query("SELECT local_id::int AS local_id, occurred_at_local, action, detail, changed_by FROM gd.mildura_changes WHERE device_id=$1 ORDER BY occurred_at_local DESC, local_id DESC LIMIT 300", [d]),
  ]);
  return { site: milduraSite(), units: units.rows, users: users.rows, schedules: schedules.rows, persons: persons.rows, access: access.rows, access30: access30.rows, changes: changes.rows };
}

export async function mirrorUnit(c: GdClient) {
  const r = (await c.query("SELECT device_id AS id, command_pubkey, last_status FROM gd.devices WHERE device_id=$1", [MILDURA_DEVICE_ID])).rows[0];
  return r as { id: string; command_pubkey: string | null; last_status: Record<string, unknown> | null } | undefined;
}

export async function mirrorCommands(c: GdClient) {
  return (await c.query(`SELECT ${COMMAND_COLUMNS} FROM gd.mildura_commands WHERE device_id=$1 ORDER BY created_at DESC LIMIT 50`, [MILDURA_DEVICE_ID])).rows;
}

/** Queue a command. The same click twice returns the first command instead of queueing again. */
export async function enqueue(c: GdClient, row: { id: string; client_key: string; kind: string; args: Record<string, unknown>; sealed: string | null; actor_email: string; expires_at?: string }) {
  const seen = await c.query(`SELECT ${COMMAND_COLUMNS} FROM gd.mildura_commands WHERE device_id=$1 AND client_key=$2`, [MILDURA_DEVICE_ID, row.client_key]);
  if (seen.rowCount) return { command: seen.rows[0], duplicate: true };
  const made = await c.query(
    `INSERT INTO gd.mildura_commands(id,device_id,client_key,kind,args,sealed,actor_email,expires_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,COALESCE($8::timestamptz, now() + interval '15 minutes')) RETURNING ${COMMAND_COLUMNS}`,
    [row.id, MILDURA_DEVICE_ID, row.client_key, row.kind, JSON.stringify(row.args), row.sealed, row.actor_email, row.expires_at ?? null]);
  return { command: made.rows[0], duplicate: false };
}

/** Portal-side audit next to the Pi's changes_log mirror (negative local_id from the DB default). */
export async function audit(c: GdClient, entry: { action: string; detail: string; changed_by: string; occurred_at_local: string }) {
  await c.query("INSERT INTO gd.mildura_changes(device_id,occurred_at_local,action,detail,changed_by,source) VALUES ($1,$2,$3,$4,$5,'portal')",
    [MILDURA_DEVICE_ID, entry.occurred_at_local, entry.action, entry.detail, entry.changed_by]);
}
