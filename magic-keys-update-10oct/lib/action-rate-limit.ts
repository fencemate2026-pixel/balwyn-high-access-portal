/**
 * Shared, database-backed rate limit for expensive or physical actions.
 *
 * One atomic statement: a slot is recorded only while fewer than `max` slots
 * exist for the same fingerprint inside the window. The database function runs
 * every write under one writer lock, so two requests cannot both take the last
 * slot. Uses the existing auth_attempts table with action-prefixed fingerprints
 * (for example "remote-open:gate:TF-ENTRY"), which never collide with sign-in
 * fingerprints. Throws if the database is unreachable: callers fail closed.
 */
import { getSql } from "@/db";

export async function takeActionSlot(fingerprint: string, max: number, windowMs: number): Promise<boolean> {
  if (!/^[a-z-]+:[a-z-]+:[\w@.+-]{1,200}$/i.test(fingerprint)) throw new Error("Invalid rate-limit key.");
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowMs) || windowMs < 1000) throw new Error("Invalid rate-limit window.");
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs).toISOString();
  const sql = getSql();
  // One transaction: drop this key's expired slots (keeps the table small), then
  // take a slot only if the key is still under its limit inside the window.
  const [, taken] = await sql.batch([
    sql.prepare("DELETE FROM auth_attempts WHERE fingerprint = ? AND success = 1 AND created_at <= ?").bind(fingerprint, cutoff),
    sql.prepare(
      "INSERT INTO auth_attempts (fingerprint, success, created_at) SELECT ?, 1, ? WHERE (SELECT COUNT(*) FROM auth_attempts WHERE fingerprint = ? AND created_at > ?) < ?",
    ).bind(fingerprint, now.toISOString(), fingerprint, cutoff, max),
  ]);
  return Number(taken?.meta?.changes ?? 0) === 1;
}

/**
 * Rate-limit key for a person: prefix plus a SHA-256 of their lower-cased
 * identity (email or account id). Any identity works (apostrophes, long or
 * placeholder emails), and the stored key does not reveal the address.
 */
export async function personKey(prefix: string, identity: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.trim().toLowerCase()));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hex.slice(0, 40)}`;
}

