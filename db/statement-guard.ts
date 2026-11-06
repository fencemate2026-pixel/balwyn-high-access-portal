/**
 * Request guard for the portal's direct PostgreSQL connection.
 *
 * This is the same guard the Supabase `balwyn-portal-db` Edge Function applies
 * (supabase/functions/balwyn-portal-db/index.ts, version 5), kept identical so
 * moving the database does not loosen any protection. The portal only ever
 * sends single SELECT / INSERT / UPDATE / DELETE statements with bound
 * parameters; anything else is refused before it reaches the database.
 */
export type Statement = { sql: string; params: unknown[] };

export const MAX_STATEMENTS = 100;
export const MAX_SQL_CHARS = 32768;
export const MAX_PARAMS = 1000;
/** Global single-writer advisory lock key (same value as the Edge Function). */
export const WRITE_LOCK_KEY = 672419830;

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE)\b/i;
const ALLOWED_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i;
// A SELECT could otherwise call set_config('role', ...) to leave the balwyn_app
// role, take the global advisory lock to stall every writer, or read server files.
const FORBIDDEN_PATTERN = /\b(set_config|pg_advisory\w*|pg_sleep\w*|dblink\w*|pg_read_\w+|pg_ls_\w+|lo_import|lo_export)\b/i;

/** True when a ';' or a dollar-quoted body remains outside strings and comments (stacked statements). */
export function hasStackedStatement(text: string): boolean {
  const code = text
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  return /;|\$\w*\$/.test(code);
}

export class InvalidStatementError extends Error {
  readonly code = "INVALID_REQUEST";
}

/** Throws InvalidStatementError unless every statement is one allowed, parameterised statement. */
export function assertValidStatements(statements: Statement[]): void {
  const valid = Array.isArray(statements) && statements.length > 0 && statements.length <= MAX_STATEMENTS
    && statements.every((s) => typeof s?.sql === "string" && s.sql.length <= MAX_SQL_CHARS
      && ALLOWED_PATTERN.test(s.sql) && !FORBIDDEN_PATTERN.test(s.sql) && !hasStackedStatement(s.sql)
      && Array.isArray(s.params) && s.params.length <= MAX_PARAMS
      && s.params.every((p) => p === null || ["string", "number", "boolean"].includes(typeof p)));
  if (!valid) throw new InvalidStatementError("Invalid database request");
}

/** A batch is a write if ANY statement writes; mixed batches take the writer lock. */
export function batchWrites(statements: Statement[]): boolean {
  return statements.some((s) => WRITE_PATTERN.test(s.sql));
}
