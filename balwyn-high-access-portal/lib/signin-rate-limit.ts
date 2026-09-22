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
