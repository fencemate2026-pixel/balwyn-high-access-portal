/**
 * Runs a validated batch of statements on one PostgreSQL connection with the
 * same transaction rules as the Supabase Edge Function:
 *  - everything runs as the restricted role `balwyn_app` inside balwyn_portal;
 *  - read-only batches use a READ ONLY, REPEATABLE READ transaction (one
 *    snapshot, no writes possible, no writer lock);
 *  - batches that write use READ COMMITTED and take the global advisory lock
 *    (5 s wait limit) so rate limits, one-time codes, controller claims and the
 *    facility-hire clash check keep their single-writer guarantee;
 *  - any failure rolls the whole batch back; 10 s statement timeout.
 */
import { assertValidStatements, batchWrites, WRITE_LOCK_KEY, type Statement } from "./statement-guard.ts";

export type QueryResult = { rows: unknown[][]; columns: string[]; count: number };

/** One connection. Implemented for node-postgres in production and PGlite in tests. */
export interface PortalConnection {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

/** JSON-safe value, matching what the Edge Function returned (dates as ISO text). */
function normalise(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalise);
  return value;
}

export async function runStatements(connection: PortalConnection, statements: Statement[]): Promise<QueryResult[]> {
  assertValidStatements(statements);
  const writes = batchWrites(statements);
  await connection.query(writes ? "BEGIN ISOLATION LEVEL READ COMMITTED" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await connection.query("SET LOCAL ROLE balwyn_app");
    await connection.query("SET LOCAL search_path = balwyn_portal, pg_catalog");
    await connection.query("SET LOCAL statement_timeout = '10s'");
    if (writes) {
      await connection.query("SET LOCAL lock_timeout = '5s'");
      await connection.query(`SELECT pg_advisory_xact_lock(${WRITE_LOCK_KEY})`);
    }
    const results: QueryResult[] = [];
    for (const statement of statements) {
      const result = await connection.query(statement.sql, statement.params);
      results.push({ rows: result.rows.map((row) => row.map(normalise)), columns: result.columns, count: result.count });
    }
    await connection.query("COMMIT");
    return results;
  } catch (error) {
    try { await connection.query("ROLLBACK"); } catch { /* connection already unusable */ }
    throw error;
  }
}
