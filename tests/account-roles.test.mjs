import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredRole, parseAccountRoles } from '../lib/account-roles.ts';
test('allowlist roles preserve existing accounts and reject malformed or ambiguous assignments', () => {
  const valid = id => id.includes('@');
  const roles = parseAccountRoles('legacy@example.test,reader@example.test|viewer,op@example.test|operator', valid);
  assert.equal(roles.get('legacy@example.test'), 'administrator');
  assert.equal(roles.get('reader@example.test'), 'viewer');
  assert.equal(roles.get('op@example.test'), 'operator');
  for (const raw of ['reader@example.test|admin', 'reader@example.test|', 'reader@example.test|viewer|administrator', 'reader@example.test|viewer,READER@example.test|administrator']) assert.throws(() => parseAccountRoles(raw, valid));
  assert.throws(() => configuredRole('superuser'));
});
