// gd-mirror v1 (STAGED, NOT DEPLOYED). Receives the Mildura Pi's read-only mirror.
// Same auth as gd-device: body.device_id + body.secret; only sha256(secret) is stored (gd_units.secret_hash).
// One action: "push" = heartbeat + idempotent upserts. It never returns config and never writes
// anything the Pi could act on: this is a one-way mirror (Phase 1).
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MAX_ROWS = 500;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown, n = 500) => (v == null ? null : String(v).slice(0, n));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const arr = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_ROWS) : []);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  let b: any; try { b = await req.json(); } catch { return json(400, { error: "json" }); }
  const deviceId = String(b?.device_id ?? ""), secret = String(b?.secret ?? "");
  if (!deviceId || secret.length < 32) return json(401, { error: "auth" });
  const { data: unit } = await db.from("gd_units").select("*").eq("device_id", deviceId).maybeSingle();
  if (!unit || !unit.secret_hash || !safeEq(await sha256hex(secret), unit.secret_hash)) { await sleep(400); return json(401, { error: "auth" }); }
  if (b.action !== "push") return json(400, { error: "action" });
  const site = unit.site_id;

  // Heartbeat first so last_seen is fresh even if a table write fails below.
  const status = b.status && typeof b.status === "object" ? b.status : null;
  await db.from("gd_units").update({ last_seen: new Date().toISOString(), last_status: status, fw_version: str(b.fw_version, 40) }).eq("id", unit.id);

  const up = async (table: string, rows: any[]) => {
    if (!rows.length) return null;
    const { error } = await db.from(table).upsert(rows, { onConflict: "site_id,local_id" });
    return error ? error.message : null;
  };
  const sn = b.snapshots ?? {}, st = b.streams ?? {};
  const errs = (await Promise.all([
    up("gd_mirror_users", arr(sn.users).map((r: any) => ({ site_id: site, local_id: r.id, name: str(r.name, 200) ?? "", enabled: bool(r.enabled), schedule_type: str(r.schedule_type, 40), schedule_data: str(r.schedule_data, 2000), created_at_local: str(r.created_at, 40), synced_at: new Date().toISOString() }))),
    up("gd_mirror_schedules", arr(sn.auto_schedules).map((r: any) => ({ site_id: site, local_id: r.id, name: str(r.name, 200), days: str(r.days, 100), open_time: str(r.open_time, 10), close_time: str(r.close_time, 10), enabled: bool(r.enabled), synced_at: new Date().toISOString() }))),
    up("gd_mirror_persons", arr(sn.auth_persons).map((r: any) => ({ site_id: site, local_id: r.id, name: str(r.name, 200), role: str(r.role, 100), synced_at: new Date().toISOString() }))),
    up("gd_mirror_access", arr(st.access_log).map((r: any) => ({ site_id: site, local_id: r.id, occurred_at_local: str(r.timestamp, 40), user_name: str(r.user_name, 200), method: str(r.method, 40), success: bool(r.success) }))),
    up("gd_mirror_changes", arr(st.changes_log).map((r: any) => ({ site_id: site, local_id: r.id, occurred_at_local: str(r.timestamp, 40), action: str(r.action, 80), detail: str(r.detail, 500), changed_by: str(r.changed_by, 120) }))),
  ])).filter(Boolean);
  // Snapshot tables are full copies: drop rows the Pi no longer has so deletions mirror too.
  for (const [t, key, ids] of [["gd_mirror_users", "users", arr(sn.users)], ["gd_mirror_schedules", "auto_schedules", arr(sn.auto_schedules)], ["gd_mirror_persons", "auth_persons", arr(sn.auth_persons)]] as const) {
    if (sn[key] !== undefined && Array.isArray(sn[key]) && sn[key].length < MAX_ROWS) {
      const keep = ids.map((r: any) => r.id);
      const q = db.from(t).delete().eq("site_id", site);
      const { error } = keep.length ? await q.not("local_id", "in", `(${keep.join(",")})`) : await q;
      if (error) errs.push(error.message);
    }
  }
  // Ack only when every write succeeded so the Pi keeps its marks and retries.
  return errs.length ? json(500, { ok: false, error: "store" }) : json(200, { ok: true });
});
