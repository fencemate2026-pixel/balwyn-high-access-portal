// Visitor address used by sign-in rate limits (12 Oct 2026).
// On Azure App Service there is no Cloudflare, so cf-connecting-ip must be
// ignored (a browser can send it) and the App Service client-ip header used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { clientAddress, clientAddressSource, normaliseAddress } from '../lib/client-address.ts';

const request = headers => new Request('https://portal.example/api/auth/email', { method: 'POST', headers });

/** Runs fn with the given environment overrides, restoring the originals afterwards. */
function withEnv(t, values) {
  const keys = ['PORTAL_CLIENT_ADDRESS_SOURCE', 'WEBSITE_SITE_NAME'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
}

test('source: App Service is detected from WEBSITE_SITE_NAME; Render stays on Cloudflare', t => {
  withEnv(t, {});
  assert.equal(clientAddressSource(), 'cloudflare');
  process.env.WEBSITE_SITE_NAME = 'magickeys-balwyn-portal';
  assert.equal(clientAddressSource(), 'azure');
});

test('source: explicit setting wins; unknown values are ignored', t => {
  withEnv(t, { WEBSITE_SITE_NAME: 'magickeys-balwyn-portal', PORTAL_CLIENT_ADDRESS_SOURCE: 'cloudflare' });
  assert.equal(clientAddressSource(), 'cloudflare');
  process.env.PORTAL_CLIENT_ADDRESS_SOURCE = ' Azure ';
  assert.equal(clientAddressSource(), 'azure');
  process.env.PORTAL_CLIENT_ADDRESS_SOURCE = 'x-forwarded-for';
  assert.equal(clientAddressSource(), 'azure', 'falls back to detection');
});

test('azure: uses client-ip with the port removed and ignores a browser-supplied cf-connecting-ip', t => {
  withEnv(t, { WEBSITE_SITE_NAME: 'magickeys-balwyn-portal' });
  assert.equal(clientAddress(request({ 'client-ip': '203.0.113.157:63546', 'cf-connecting-ip': '198.51.100.9' })), '203.0.113.157');
  assert.equal(clientAddress(request({ 'cf-connecting-ip': '198.51.100.9' })), 'unknown');
});

test('azure: falls back to x-client-ip, then to "unknown"', t => {
  withEnv(t, { WEBSITE_SITE_NAME: 'magickeys-balwyn-portal' });
  assert.equal(clientAddress(request({ 'x-client-ip': '203.0.113.157' })), '203.0.113.157');
  assert.equal(clientAddress(request({ 'client-ip': 'garbage', 'x-client-ip': '203.0.113.8' })), '203.0.113.8');
  assert.equal(clientAddress(request({})), 'unknown');
});

test('cloudflare: unchanged behaviour for Render', t => {
  withEnv(t, {});
  assert.equal(clientAddress(request({ 'cf-connecting-ip': '192.0.2.1', 'client-ip': '203.0.113.2' })), '192.0.2.1');
  assert.equal(clientAddress(request({ 'client-ip': '203.0.113.2' })), 'unknown');
});

test('different Azure visitors get different addresses (no shared bucket)', t => {
  withEnv(t, { WEBSITE_SITE_NAME: 'magickeys-balwyn-portal' });
  assert.notEqual(clientAddress(request({ 'client-ip': '203.0.113.1:1000' })), clientAddress(request({ 'client-ip': '203.0.113.2:1000' })));
});

test('normaliseAddress accepts IPv4/IPv6 forms and rejects anything else', () => {
  assert.equal(normaliseAddress('203.0.113.157'), '203.0.113.157');
  assert.equal(normaliseAddress(' 203.0.113.157:443 '), '203.0.113.157');
  assert.equal(normaliseAddress('2001:DB8::1'), '2001:db8::1');
  assert.equal(normaliseAddress('[2001:db8::1]:8443'), '2001:db8::1');
  assert.equal(normaliseAddress('[2001:db8::1]'), '2001:db8::1');
  for (const bad of [null, '', 'unknown', '203.0.113.1, 198.51.100.2', '<script>', 'a'.repeat(80), '203.0.113.1:99999999']) {
    assert.equal(normaliseAddress(bad), null, `value ${JSON.stringify(bad)}`);
  }
});
