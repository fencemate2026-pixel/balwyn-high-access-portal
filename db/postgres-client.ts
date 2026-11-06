import { supabaseFetch } from "../lib/supabase-server";
import { directDatabaseConfigured, executeDirect } from "./direct-postgres";
import { directFailureCode, safeFailureCode } from "./failure-code";

export type Statement = { sql: string; params: unknown[] };
type QueryResult = { rows: unknown[][]; columns: string[]; count: number };

import { postgresPlaceholders } from "./sql-dialect";

export async function executeStatements(statements: Statement[]): Promise<QueryResult[]> {
  // Direct PostgreSQL (Azure) when PORTAL_DATABASE_URL is set; otherwise the Supabase Edge Function.
  if (directDatabaseConfigured()) {
    try { return await executeDirect(statements); }
    catch (failure) {
      const code = directFailureCode(failure);
      console.error("portal_database_direct_failed", { code });
      throw new Error(`Portal database unavailable (direct, SQLSTATE ${code}).`);
    }
  }
  const response = await supabaseFetch("/functions/v1/balwyn-portal-db", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statements }),
  });
  if (!response.ok) {
    // Only preserve a SQLSTATE or a short transport identifier. Upstream messages can contain data.
    const failure: unknown = await response.json().catch(() => null);
    throw new Error(`Portal database unavailable (${response.status}, SQLSTATE ${safeFailureCode(failure)}).`);
  }
  const body = await response.json();
  if (!Array.isArray(body.results) || body.results.length !== statements.length) throw new Error("Invalid database response.");
  return body.results;
}

function objects<T>(result: QueryResult): T[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((name, i) => [name, row[i]])) as T);
}

export class PortalStatement {
  constructor(readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new PortalStatement(this.sql, params); }
  asQuery(): Statement { return { sql: postgresPlaceholders(this.sql), params: this.params }; }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const [result] = await executeStatements([this.asQuery()]);
    const row = objects<Record<string, unknown>>(result)[0];
    return row ? (column ? row[column] : row) as T : null;
  }
  async all<T = Record<string, unknown>>() {
    const [result] = await executeStatements([this.asQuery()]);
    return { success: true, results: objects<T>(result), meta: { changes: result.count } };
  }
  async run<T = Record<string, unknown>>() { return this.all<T>(); }
  async raw<T = unknown[]>() {
    const [result] = await executeStatements([this.asQuery()]);
    return result.rows as T[];
  }
}

export class PortalSql {
  prepare(sql: string) { return new PortalStatement(sql); }
  async batch<T = Record<string, unknown>>(statements: PortalStatement[]) {
    if (!statements.length) return [];
    const results = await executeStatements(statements.map(s => s.asQuery()));
    return results.map(result => ({ success: true, results: objects<T>(result), meta: { changes: result.count } }));
  }
}
