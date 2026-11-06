/**
 * Thomastown swing gate — data access for the Azure "gd" schema. Server-only.
 * Every function takes the transaction client, so the routes decide transaction boundaries and the
 * tests run the real SQL against PostgreSQL semantics (PGlite) using deploy/azure/gd/001_*.sql.
 */
import type { GdClient } from "@/lib/gd-db";
import { COMMAND_TTL_MINUTES, SWING_DEVICE_ID, type PushBody, type SwingCommandInput } from "@/lib/gd-swing-model";
import { melbourneNow } from "@/lib/mildura-commands-model";

const COMMAND_COLUMNS = "id,seq,kind,args,status,actor_email,error,result,created_at,finished_at";
const MAX_ATTEMPTS = 5;

/** Single-use nonce. Returns false when it was seen before (a replay). Old nonces are cleared first. */
export async function useNonce(c: GdClient, device: string, nonce: string): Promise<boolean> {
  await c.query("DELETE FROM gd.device_nonces WHERE seen_at < now() - interval '10 minutes'");
  const r = await c.query("INSERT INTO gd.device_nonces(device_id, nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING", [device, nonce]);
  return r.rowCount === 1;
}

export async function deviceKnown(c: GdClient, device: string): Promise<boolean> {
  return (await c.query("SELECT 1 FROM gd.devices WHERE device_id = $1", [device])).rowCount === 1;
}

/** Store what the Pi sent. Users are a full snapshot (replace); logs are append-only by the Pi's own id. */
export async function applyPush(c: GdClient, device: string, p: PushBody): Promise<{ users: number; access: number; changes: number }> {
  await c.query("UPDATE gd.devices SET last_seen = now(), fw_version = COALESCE($2, fw_version), last_status = COALESCE($3::jsonb, last_status) WHERE device_id = $1",
    [device, p.fw_version, p.status ? JSON.stringify(p.status) : null]);
  if (p.users) {
    const ids = p.users.map((u) => u.local_id);
    await c.query("DELETE FROM gd.users WHERE device_id = $1 AND NOT (local_id = ANY($2::bigint[]))", [device, ids]);
    for (const u of p.users) {
      await c.query(
        `INSERT INTO gd.users(device_id,local_id,name,phone,enabled,schedule_type,schedule_data,created_at_local,synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (device_id,local_id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, enabled=EXCLUDED.enabled,
           schedule_type=EXCLUDED.schedule_type, schedule_data=EXCLUDED.schedule_data, created_at_local=EXCLUDED.created_at_local, synced_at=now()`,
        [device, u.local_id, u.name, u.phone, u.enabled, u.schedule_type, u.schedule_data, u.created_at_local]);
    }
  }
  for (const a of p.access) {
    await c.query("INSERT INTO gd.access_log(device_id,local_id,occurred_at_local,user_name,method,success) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [device, a.local_id, a.occurred_at_local, a.user_name, a.method, a.success]);
  }
  for (const ch of p.changes) {
    await c.query("INSERT INTO gd.changes(device_id,local_id,occurred_at_local,action,detail,changed_by,source) VALUES ($1,$2,$3,$4,$5,$6,'pi') ON CONFLICT DO NOTHING",
      [device, ch.local_id, ch.occurred_at_local, ch.action, ch.detail, ch.changed_by]);
  }
  return { users: p.users?.length ?? 0, access: p.access.length, changes: p.changes.length };
}

/** Hand the Pi its waiting commands. Stale ones are expired first; each is delivered at most MAX_ATTEMPTS times. */
export async function takeCommands(c: GdClient, device: string) {
  await c.query("UPDATE gd.commands SET status='expired', finished_at=now() WHERE device_id=$1 AND status IN ('pending','delivered') AND (expires_at < now() OR attempts >= $2)", [device, MAX_ATTEMPTS]);
  const r = await c.query(
    `UPDATE gd.commands SET status='delivered', attempts=attempts+1, delivered_at=now()
     WHERE id IN (SELECT id FROM gd.commands WHERE device_id=$1 AND status IN ('pending','delivered') ORDER BY seq LIMIT 10 FOR UPDATE)
     RETURNING id, seq, kind, args, expires_at`, [device]);
  return [...r.rows].sort((x, y) => Number(x.seq) - Number(y.seq));
}

/** Pi reports a result. Only an open command of THIS device can be finished, and only once. */
export async function ackCommand(c: GdClient, device: string, id: string, ok: boolean, error: string | null, result: Record<string, unknown> | null) {
  const r = await c.query(
    `UPDATE gd.commands SET status=$3, error=$4, result=$5::jsonb, finished_at=now()
     WHERE id=$1 AND device_id=$2 AND status IN ('pending','delivered') RETURNING id`,
    [id, device, ok ? "applied" : "failed", ok ? null : (error ?? "Failed").slice(0, 200), result ? JSON.stringify(result) : null]);
  return r.rowCount === 1;
}

// ---- Owner side ----
export async function getDetail(c: GdClient, device = SWING_DEVICE_ID) {
  const [dev, users, access, changes] = await Promise.all([
    c.query("SELECT device_id, site_name, last_seen, fw_version, last_status FROM gd.devices WHERE device_id=$1", [device]),
    c.query("SELECT local_id,name,phone,enabled,schedule_type,schedule_data,created_at_local FROM gd.users WHERE device_id=$1 ORDER BY name", [device]),
    c.query("SELECT local_id,occurred_at_local,user_name,method,success FROM gd.access_log WHERE device_id=$1 ORDER BY local_id DESC LIMIT 500", [device]),
    c.query("SELECT local_id,occurred_at_local,action,detail,changed_by,source FROM gd.changes WHERE device_id=$1 ORDER BY received_at DESC, local_id DESC LIMIT 300", [device]),
  ]);
  return { device: dev.rows[0] ?? null, users: users.rows, access: access.rows, changes: changes.rows };
}

export async function listCommands(c: GdClient, device = SWING_DEVICE_ID) {
  return (await c.query(`SELECT ${COMMAND_COLUMNS} FROM gd.commands WHERE device_id=$1 ORDER BY created_at DESC LIMIT 50`, [device])).rows;
}

/** Queue a command. The same click twice returns the first command instead of queueing again. */
export async function enqueueCommand(c: GdClient, input: SwingCommandInput, actorEmail: string, device = SWING_DEVICE_ID) {
  const seen = await c.query(`SELECT ${COMMAND_COLUMNS} FROM gd.commands WHERE device_id=$1 AND client_key=$2`, [device, input.clientKey]);
  if (seen.rowCount) return { command: seen.rows[0], duplicate: true };
  const made = await c.query(
    `INSERT INTO gd.commands(id,device_id,client_key,kind,args,actor_email,expires_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6, now() + ($7 || ' minutes')::interval) RETURNING ${COMMAND_COLUMNS}`,
    [crypto.randomUUID(), device, input.clientKey, input.kind, JSON.stringify(input.args), actorEmail, String(COMMAND_TTL_MINUTES)]);
  await c.query("INSERT INTO gd.changes(device_id,occurred_at_local,action,detail,changed_by,source) VALUES ($1,$2,$3,$4,$5,'portal')",
    [device, melbourneNow(), `portal.${input.kind}`, `Queued: ${input.summary}`, `portal:${actorEmail}`]);
  return { command: made.rows[0], duplicate: false };
}
