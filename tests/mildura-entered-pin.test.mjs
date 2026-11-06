import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

async function importSource(path, prefix, remove) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(remove, '');
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(prefix + source)).toString('base64'));
}

test('owner detail joins only actual visible event PINs; charts and credential lists have no PINs', async () => {
  const sid = '55555555-5555-4555-8555-555555555555';
  const calls = [];
  globalThis.__pinFetch = async (path) => {
    calls.push(decodeURIComponent(path));
    const table = path.split('?')[0];
    let rows = [];
    if (table === 'gd_sites') rows = [{ id: sid, slug: 'mildura', name: 'Test' }];
    if (table === 'gd_mirror_access' && path.includes('local_id,')) rows = [
      { local_id: 1, user_name: 'A', success: false },
      { local_id: 2, user_name: 'B', success: true },
    ];
    if (table === 'gd_mirror_access_pins') rows = [{ local_id: 1, attempted_pin: '001234' }];
    return Response.json(rows);
  };
  const mod = await importSource('../lib/owner-sites-store.ts', `
    const supabaseFetch = (path, init) => globalThis.__pinFetch(path.replace('/rest/v1/', ''), init);
    class OwnerSiteInputError extends Error {}
    const isSlug = (s) => /^[a-z-]+$/.test(s);
    const isUuid = (s) => /^[a-f0-9-]{36}$/.test(s);
  `, /^import .*;\n/gm);
  const result = await mod.getMirrorDetail('mildura');
  assert.equal(result.access[0].entered_pin, '001234');
  assert.equal(result.access[1].entered_pin, null, 'do not guess the current credential');
  const pins = calls.filter((c) => c.startsWith('gd_mirror_access_pins?'));
  assert.equal(pins.length, 1);
  assert.ok(pins[0].includes(`site_id=eq.${sid}`));
  assert.ok(pins[0].includes('local_id=in.(1,2)'));
  assert.ok(calls.filter((c) => /gd_mirror_users|gd_mirror_persons/.test(c)).every((c) => !/pin/.test(c)));
  delete globalThis.__pinFetch;
});

test('edge separates access PINs from admin-readable metadata and preserves leading zeros', async () => {
  const writes = [];
  const secret = 'test-only-secret-'.repeat(3);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let metadataWritten = false;
  globalThis.__pinDb = { from(table) {
    const q = {
      select() { return q; }, eq() { return q; },
      async maybeSingle() { return { data: { id: 'unit', site_id: 'site', secret_hash: digest } }; },
      update() { return q; },
      async upsert(rows) {
        if (table === 'gd_mirror_access_pins') assert.ok(metadataWritten, 'write parent event first');
        writes.push({ table, rows });
        if (table === 'gd_mirror_access') metadataWritten = true;
        return { error: null };
      },
      then(resolve) { resolve({ error: null }); },
    }; return q;
  }};
  globalThis.__pinDeno = { env: { get: () => 'test' }, serve(handler) { globalThis.__pinHandler = handler; } };
  await importSource('../deploy/mildura/cloud/gd-mirror.index.ts.txt', `
    const createClient = () => globalThis.__pinDb;
    const Deno = globalThis.__pinDeno;
  `, /^import .*;\n/gm);
  const response = await globalThis.__pinHandler(new Request('https://example.invalid', {
    method: 'POST', body: JSON.stringify({ device_id: 'test', secret, action: 'push', streams: { access_log: [
      { id: 1, attempted_pin: '001234', success: false },
      { id: 2, attempted_pin: '123456', success: true },
      { id: 3, attempted_pin: null, success: true },
      { id: 4, attempted_pin: 'invalid' },
    ] } }),
  }));
  assert.equal(response.status, 200);
  const metadata = writes.find((w) => w.table === 'gd_mirror_access');
  assert.ok(metadata.rows.every((r) => !('attempted_pin' in r)));
  const pins = writes.find((w) => w.table === 'gd_mirror_access_pins');
  assert.deepEqual(pins.rows.map((r) => r.attempted_pin), ['001234', '123456']);
  assert.ok(pins.rows.every((r) => r.site_id === 'site'));
  for (const key of ['__pinDb', '__pinDeno', '__pinHandler']) delete globalThis[key];
});

test('actual owner route denies school administrators before any PIN or mirror read', async () => {
  let reads = 0;
  globalThis.__pinRole = false;
  globalThis.__pinRead = async () => { reads++; return { access: [{ entered_pin: '001234' }] }; };
  const mod = await importSource('../app/api/owner/sites/route.ts', `
    const requireOperator = async () => ({ user: { isOwner: globalThis.__pinRole } });
    const getMirrorDetail = (...args) => globalThis.__pinRead(...args);
    const milduraOnAzure = () => false, gdTransaction = async () => null, mirrorDetail = null, siteRow = null;   // Azure path: covered by mildura-azure.test.mjs
    class OwnerSiteInputError extends Error {}
    class OwnerSitesUnavailableError extends Error {}
  `, /^import[\s\S]*?from ["'][^"']+["'];\n/gm);
  const req = () => new Request('https://example.invalid/api/owner/sites?site=mildura&view=mirror');
  assert.equal((await mod.GET(req())).status, 404);
  assert.equal(reads, 0);
  globalThis.__pinRole = true;
  const response = await mod.GET(req());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).access[0].entered_pin, '001234');
  for (const key of ['__pinRead', '__pinRole']) delete globalThis[key];
});
