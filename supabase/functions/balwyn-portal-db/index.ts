import postgres from "npm:postgres@3.4.9";

// Server-to-server transport only. Browser user tokens are never accepted.
// The database role can access only balwyn_portal, not other applications.
//
// SOURCE OF TRUTH: this file mirrors the DEPLOYED function, version 5
// (Supabase project aevsfrxqyvtuycufffxk, read back 27 Sep 2026). The repo copy
// had fallen behind at version 4; redeploying the old copy would have
// reintroduced the "too many clients" outage fixed on 23 Sep.
//
// CHANGE (23 Sep 2026): reads no longer queue behind the global advisory lock.
// Previously EVERY request, including plain SELECTs, took pg_advisory_xact_lock
// and held its database connection while waiting. A burst of dashboard reads
// after a deploy therefore piled up waiting connections until Postgres refused
// new ones (SQLSTATE 53300, "too many clients"), observed 10:33-10:34 UTC.
//
// Writes (any batch containing INSERT/UPDATE/DELETE) still take the same lock,
// so rate limits, one-time-code consumption, controller claims and the
// facility-hire clash check keep their single-writer guarantee.
// A read-only batch cannot change anything, so it needs no writer lock.
//
// Waiting for the lock is now bounded: a writer that cannot get the lock within
// 5 s fails with 55P03 and releases its connection instead of holding it.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false, max: 1, idle_timeout: 10, connect_timeout: 10,
});

const WRITE_LOCK_KEY = 672419830;
const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE)\b/i;
const ALLOWED_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i;

function safeFailureCode(error: unknown): string {
  const raw = typeof error === "object" && error && "code" in error ? String(error.code) : "unavailable";
  if (/^[0-9A-Z]{5}$/.test(raw) || /^[A-Z][A-Z0-9_]{1,40}$/.test(raw)) return raw;
  return "unavailable";
}

async function authorised(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!supplied) return false;
  // Supabase's verify_jwt=true gateway validates the signature before invoking
  // this function. Authorisation then additionally requires the service role
  // and this project; a valid anon or user JWT is insufficient.
  try {
    const encoded = supplied.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded));
    const project = new URL(Deno.env.get("SUPABASE_URL")!).hostname.split(".")[0];
    return claims.role === "service_role" && claims.ref === project && claims.exp > Date.now() / 1000;
  } catch { return false; }
}

Deno.serve(async request => {
  const headers = { "Cache-Control": "no-store" };
  if (!await authorised(request)) return Response.json({ error: "Unauthorised" }, { status: 401, headers });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 131072) return new Response(null, { status: 413 });
    const text = await request.text();
    if (text.length > 131072) return new Response(null, { status: 413 });
    const { statements } = JSON.parse(text);
    if (!Array.isArray(statements) || !statements.length || statements.length > 100 || statements.some(s =>
      typeof s.sql !== "string" || s.sql.length > 32768 || !ALLOWED_PATTERN.test(s.sql)
      || !Array.isArray(s.params) || s.params.length > 1000
      || s.params.some((p: unknown) => p !== null && !["string", "number", "boolean"].includes(typeof p)))) {
      return Response.json({ error: "Invalid database request" }, { status: 400, headers });
    }
    // A batch is a write if ANY statement writes. Mixed batches take the lock.
    // Read-only batches run in a READ ONLY, REPEATABLE READ transaction:
    //  - READ ONLY makes Postgres reject any write, so a batch classified as a
    //    read can never modify data without the writer lock.
    //  - REPEATABLE READ gives every statement in the batch the same snapshot,
    //    so a dashboard read never mixes before/after states of a write.
    const writes = statements.some((s: { sql: string }) => WRITE_PATTERN.test(s.sql));
    const mode = writes ? "isolation level read committed" : "isolation level repeatable read read only";
    const results = await sql.begin(mode, async transaction => {
      await transaction`SET LOCAL ROLE balwyn_app`;
      await transaction`SET LOCAL search_path = balwyn_portal, pg_catalog`;
      await transaction`SET LOCAL statement_timeout = '10s'`;
      if (writes) {
        // Single-writer atomicity for rate limits, OTP consumption and
        // controller claims, including multi-statement batches.
        await transaction`SET LOCAL lock_timeout = '5s'`;
        await transaction.unsafe(`SELECT pg_advisory_xact_lock(${WRITE_LOCK_KEY})`); // literal, as in v4
      }
      const results = [];
      for (const statement of statements) {
        const result = await transaction.unsafe(statement.sql, statement.params).values();
        const columns = Array.isArray(result.columns) ? result.columns.map(column => column.name) : [];
        results.push({ rows: Array.from(result ?? []), columns, count: Number(result.count ?? 0) });
      }
      return results;
    });
    return Response.json({ results }, { headers });
  } catch (error) {
    const code = safeFailureCode(error);
    console.error("balwyn_database_error", code);
    return Response.json({ error: "Database operation failed", code }, { status: 503, headers });
  }
});
