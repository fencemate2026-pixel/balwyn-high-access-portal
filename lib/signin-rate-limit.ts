type Database = { prepare(sql: string): { bind(...values: (string | number)[]): { first<T>(): Promise<T | null> } } };

export class SignInRateLimitError extends Error {
  constructor() { super("Too many sign-in attempts. Please wait 15 minutes and try again."); }
}

// Reserve the attempt atomically before doing expensive password verification.
// A SELECT followed by an INSERT would let concurrent requests bypass the cap.
export async function reserveSignInAttempt(db: Database, key: string, limit = 8) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const result = await db.prepare(`INSERT INTO auth_attempts (fingerprint, success, created_at)
    SELECT ?, 0, ? WHERE (SELECT COUNT(*) FROM auth_attempts
      WHERE fingerprint = ? AND created_at > ?) < ? RETURNING id`)
    .bind(key, new Date().toISOString(), key, since, limit).first<{ id: number }>();
  if (!result) throw new SignInRateLimitError();
}

type BatchDatabase = { prepare(sql: string): { bind(...values: (string | number)[]): unknown }; batch(statements: unknown[]): Promise<{ results: unknown[] }[]> };

/** Several reservations in ONE database round trip (sign-in speed, 28 Sep 2026).
 *  Same statement and cap as reserveSignInAttempt; every key must be under its cap. */
export async function reserveSignInAttempts(db: BatchDatabase, reservations: { key: string; limit?: number }[]) {
  const now = new Date();
  const since = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const results = await db.batch(reservations.map(({ key, limit = 8 }) => db.prepare(`INSERT INTO auth_attempts (fingerprint, success, created_at)
    SELECT ?, 0, ? WHERE (SELECT COUNT(*) FROM auth_attempts
      WHERE fingerprint = ? AND created_at > ?) < ? RETURNING id`).bind(key, now.toISOString(), key, since, limit)));
  if (results.length !== reservations.length || results.some((result) => !result.results.length)) throw new SignInRateLimitError();
}
