import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresPlaceholders } from '../db/sql-dialect.ts';
import { databaseFixture } from './auth-fixture.mjs';

test('SQL conversion preserves quoted text and binds parameters independently', () => {
  assert.equal(postgresPlaceholders(`SELECT '?', 'it''s?', "?", ?, ?`), `SELECT '?', 'it''s?', "?", $1, $2`);
  assert.equal(postgresPlaceholders("SELECT 'CURRENT_TIMESTAMP', ?"), "SELECT 'CURRENT_TIMESTAMP', $1");
  assert.equal(postgresPlaceholders("SELECT 1 -- CURRENT_TIMESTAMP ?\n, ?"), "SELECT 1 -- CURRENT_TIMESTAMP ?\n, $1");
  assert.equal(postgresPlaceholders("SELECT /* CURRENT_TIMESTAMP ? */ ?"), "SELECT /* CURRENT_TIMESTAMP ? */ $1");
  assert.match(postgresPlaceholders('SELECT CURRENT_TIMESTAMP'), /to_char\(clock_timestamp/);
  assert.throws(() => postgresPlaceholders("SELECT 'unterminated"));
});

test('PostgreSQL batch rolls back every write when a later statement fails', async t => {
  const { db } = await databaseFixture(t);
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO auth_attempts (fingerprint,success) VALUES (?,0)").bind('rollback-check'),
    db.prepare('SELECT 1/0'),
  ]));
  assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM auth_attempts').first()).n), 0);
});

test('application role cannot access unrelated application data', async t => {
  const { db } = await databaseFixture(t);
  await assert.rejects(db.prepare('SELECT * FROM storage.buckets').all(), /permission denied/);
});
