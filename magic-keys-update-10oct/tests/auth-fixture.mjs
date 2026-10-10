import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgresPlaceholders } from "../db/sql-dialect.ts";

export async function databaseFixture(t) {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  // Run the production migration against PostgreSQL with the Supabase platform
  // roles and storage catalog represented locally. No network or live data.
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);`);
  await pg.exec(readFileSync(new URL("../supabase/migrations/20260920062504_balwyn_portal_netlify.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../supabase/migrations/20260924120000_portal_accounts.sql", import.meta.url), "utf8"));
  // Hire tables and the linked gate automation migration: the controller engine reads both.
  await pg.exec(readFileSync(new URL("../supabase/migrations/20260921103400_hire_bookings_balwyn_portal.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../supabase/migrations/20260926090000_linked_gate_automation.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../supabase/migrations/20260924210000_help_events.sql", import.meta.url), "utf8"));
  // Gate service counters, RJL alert outbox, append-only activity log (10 Oct 2026).
  await pg.exec(readFileSync(new URL("../supabase/migrations/20261010090000_gate_service_and_rjl_alerts.sql", import.meta.url), "utf8"));
  await pg.exec("SET ROLE balwyn_app; SET search_path = balwyn_portal, pg_catalog;");
  const statement = (sql, values = []) => ({
    sql: postgresPlaceholders(sql), values,
    bind(...bindings) { return statement(sql, bindings); },
    async first(column) { const row = (await pg.query(this.sql, this.values)).rows[0]; return row ? (column ? row[column] : row) : null; },
    async all() { const r = await pg.query(this.sql, this.values); return { success: true, results: r.rows, meta: { changes: r.affectedRows } }; },
    async run() { return this.all(); },
  });
  const db = {
    prepare: statement,
    async batch(statements) { return pg.transaction(async tx => {
      const results = [];
      for (const s of statements) { const r = await tx.query(s.sql, s.values); results.push({ success: true, results: r.rows, meta: { changes: r.affectedRows } }); }
      return results;
    }); },
  };
  const fetchDatabase = async (_path, options) => {
    const { statements } = JSON.parse(options.body);
    try { const results = await pg.transaction(async tx => {
      const result = [];
      for (const s of statements) {
        const r = await tx.query(s.sql, s.params, { rowMode: "array" });
        result.push({ rows: r.rows, columns: r.fields.map(f => f.name), count: r.affectedRows });
      }
      return result;
    }); return Response.json({ results }); }
    catch (error) { throw error; }
  };
  return { pg, db, fetchDatabase };
}

export async function passwordHash(password, salt) {
  let material = new TextEncoder().encode(password);
  for (let stage = 1; stage <= 3; stage++) {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    material = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(stage === 1 ? salt : `${salt}:stage:${stage}`), iterations: 100000 }, key, 256));
  }
  return Buffer.from(material).toString("base64url");
}
