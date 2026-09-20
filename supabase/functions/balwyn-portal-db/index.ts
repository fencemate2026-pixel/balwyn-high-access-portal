import postgres from "npm:postgres@3.4.9";

// Server-to-server transport only. Browser user tokens are never accepted.
// The database role can access only balwyn_portal, not other applications.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false, max: 1, idle_timeout: 10, connect_timeout: 10,
});

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
      typeof s.sql !== "string" || s.sql.length > 32768 || !/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(s.sql)
      || !Array.isArray(s.params) || s.params.length > 1000
      || s.params.some((p: unknown) => p !== null && !["string", "number", "boolean"].includes(typeof p)))) {
      return Response.json({ error: "Invalid database request" }, { status: 400, headers });
    }
    const results = await sql.begin(async transaction => {
      await transaction`SET LOCAL ROLE balwyn_app`;
      await transaction`SET LOCAL search_path = balwyn_portal, pg_catalog`;
      await transaction`SET LOCAL statement_timeout = '10s'`;
      // Preserve the original single-writer atomicity for rate limits, OTP
      // consumption and controller claims, including multi-statement batches.
      await transaction`SELECT pg_advisory_xact_lock(672419830)`;
      const results = [];
      for (const statement of statements) {
        const result = await transaction.unsafe(statement.sql, statement.params).values();
        results.push({ rows: Array.from(result), columns: result.columns.map(c => c.name), count: result.count });
      }
      return results;
    });
    return Response.json({ results }, { headers });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unavailable";
    console.error("balwyn_database_error", code);
    return Response.json({ error: "Database operation failed", code }, { status: 503, headers });
  }
});
