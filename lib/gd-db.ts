/**
 * Azure PostgreSQL connection for the owner-only "gd" schema (Thomastown swing gate mirror).
 * Server-only. Deliberately separate from the school portal's connection: different URL, different
 * login (a member of gd_app), so a school-portal bug or a leaked PORTAL_DATABASE_URL never reaches a
 * client's caller list.
 *
 *   GD_DATABASE_URL    postgres://gd_login:password@host:5432/db   (secret: App Service setting / Key Vault)
 *   GD_DATABASE_SSL    "off" disables TLS (local testing only); default is TLS with certificate checking
 */
import type { Pool } from "pg";
import { env } from "./server-env";

export type GdResult = { rows: Record<string, unknown>[]; rowCount: number };
export interface GdClient { query(text: string, values?: unknown[]): Promise<GdResult> }
export class GdUnavailableError extends Error {}

export function gdConfigured(): boolean { return String(env.GD_DATABASE_URL ?? "").trim() !== ""; }

let pool: Pool | null = null;
async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const { default: pg } = await import("pg");
  pg.types.setTypeParser(1114, (value: string) => new Date(`${value.replace(" ", "T")}Z`));
  pool = new pg.Pool({
    connectionString: String(env.GD_DATABASE_URL),
    ssl: String(env.GD_DATABASE_SSL ?? "").toLowerCase() === "off" ? false : { rejectUnauthorized: true },
    max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, statement_timeout: 15_000,
  });
  pool.on("error", () => { console.error("gd_database_idle_client_error"); });
  return pool;
}

type Runner = <T>(fn: (c: GdClient) => Promise<T>) => Promise<T>;
let testRunner: Runner | null = null;
/** Tests only: run transactions against an in-memory database instead of Azure. */
export function setGdRunnerForTests(r: Runner | null) { testRunner = r; }

/** Run fn in one transaction. A SQL error rolls back and releases the connection; a network error discards it. */
export const gdTransaction: Runner = async (fn) => {
  if (testRunner) return testRunner(fn);
  if (!gdConfigured()) throw new GdUnavailableError("The Thomastown swing database is not configured.");
  let client;
  try { client = await (await getPool()).connect(); }
  catch { throw new GdUnavailableError("The Thomastown swing database is not reachable right now."); }
  let discard = false;
  try {
    await client.query("BEGIN");
    const out = await fn({ query: async (text, values) => { const r = await client.query(text, values as unknown[] | undefined); return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 }; } });
    await client.query("COMMIT");
    return out;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    discard = discard || !(error && typeof error === "object" && "code" in error && /^[0-9A-Z]{5}$/.test(String((error as { code: unknown }).code)));
    throw error;
  } finally { client.release(discard ? true : undefined); }
};
