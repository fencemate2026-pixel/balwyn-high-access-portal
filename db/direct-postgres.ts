/**
 * Direct PostgreSQL connection (Azure Database for PostgreSQL) for the portal.
 *
 * Active only when PORTAL_DATABASE_URL is set; otherwise the portal keeps using
 * the Supabase Edge Function, so switching is one setting in each direction.
 * The URL is a secret: read from the environment only, never logged.
 *
 *   PORTAL_DATABASE_URL   postgres://user:password@host:5432/dbname
 *   PORTAL_DATABASE_SSL   "off" disables TLS (local testing only); default is TLS with certificate checking
 *   PORTAL_DATABASE_POOL  maximum connections, 1-20 (default 8)
 */
import type { Pool } from "pg";
import { env } from "../lib/server-env";
import { runStatements, type PortalConnection, type QueryResult } from "./run-statements";
import type { Statement } from "./statement-guard";

export function directDatabaseConfigured(): boolean {
  return String(env.PORTAL_DATABASE_URL ?? "").trim() !== "";
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const { default: pg } = await import("pg");
  // Timestamps are returned as ISO text by run-statements; read "timestamp without
  // time zone" as UTC, as the Edge Function did.
  pg.types.setTypeParser(1114, (value: string) => new Date(`${value.replace(" ", "T")}Z`));
  const size = Math.min(20, Math.max(1, Number.parseInt(String(env.PORTAL_DATABASE_POOL ?? "8"), 10) || 8));
  pool = new pg.Pool({
    connectionString: String(env.PORTAL_DATABASE_URL),
    ssl: String(env.PORTAL_DATABASE_SSL ?? "").toLowerCase() === "off" ? false : { rejectUnauthorized: true },
    max: size, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000,
  });
  // An idle client dropping must not crash the process.
  pool.on("error", () => { console.error("portal_database_idle_client_error"); });
  return pool;
}

export async function executeDirect(statements: Statement[]): Promise<QueryResult[]> {
  const client = await (await getPool()).connect();
  const connection: PortalConnection = {
    async query(text, values) {
      const result = await client.query({ text, values: values as unknown[] | undefined, rowMode: "array" });
      return { rows: result.rows as unknown[][], columns: result.fields.map((field) => field.name), count: result.rowCount ?? 0 };
    },
  };
  let discard = false;
  try { return await runStatements(connection, statements); }
  catch (error) {
    // A SQL error (it has a SQLSTATE) was rolled back and the connection is fine.
    // Anything else (network drop, timeout) means the connection is discarded, not reused.
    discard = !(error && typeof error === "object" && "code" in error && /^[0-9A-Z]{5}$/.test(String(error.code)));
    throw error;
  } finally { client.release(discard ? true : undefined); }
}
