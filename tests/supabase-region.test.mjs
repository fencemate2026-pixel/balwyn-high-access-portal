// Regression tests for the 12 Oct 2026 sign-in timeout.
// Portal database calls must run the balwyn-portal-db Edge Function in the
// database's region (Sydney), not the region nearest the web host (Oregon).
import assert from 'node:assert/strict';
import test from 'node:test';
import { edgeFunctionRegion, supabaseFetch } from '../lib/supabase-server.ts';

const ORIGIN = 'https://example-project.supabase.co';

/** Runs supabaseFetch against a stubbed fetch and returns the request it would have sent. */
async function captureRequest(t, path, env = {}) {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  process.env.SUPABASE_URL = `${ORIGIN}/`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  delete process.env.SUPABASE_FUNCTION_REGION;
  Object.assign(process.env, env);

  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: new Headers(init.headers) };
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await supabaseFetch(path, { method: 'POST', body: '{}' });
  assert.ok(captured, 'supabaseFetch did not call fetch');
  return captured;
}

test('database Edge Function calls are pinned to the Sydney database region by default', async t => {
  const request = await captureRequest(t, '/functions/v1/balwyn-portal-db');
  assert.equal(request.url, `${ORIGIN}/functions/v1/balwyn-portal-db`);
  assert.equal(request.headers.get('x-region'), 'ap-southeast-2');
  assert.equal(request.headers.get('apikey'), 'test-service-key');
  assert.equal(request.headers.get('authorization'), 'Bearer test-service-key');
});

test('storage calls are not Edge Functions and carry no region header', async t => {
  const request = await captureRequest(t, '/storage/v1/object/portal/file.png');
  assert.equal(request.headers.get('x-region'), null);
});

test('SUPABASE_FUNCTION_REGION=auto restores automatic routing', async t => {
  const request = await captureRequest(t, '/functions/v1/balwyn-portal-db', { SUPABASE_FUNCTION_REGION: 'auto' });
  assert.equal(request.headers.get('x-region'), null);
});

test('a valid override region is used as given', async t => {
  const request = await captureRequest(t, '/functions/v1/balwyn-portal-db', { SUPABASE_FUNCTION_REGION: ' AP-SOUTHEAST-1 ' });
  assert.equal(request.headers.get('x-region'), 'ap-southeast-1');
});

test('an invalid override falls back to the database region instead of disabling the pin', t => {
  const saved = process.env.SUPABASE_FUNCTION_REGION;
  t.after(() => { if (saved === undefined) delete process.env.SUPABASE_FUNCTION_REGION; else process.env.SUPABASE_FUNCTION_REGION = saved; });
  const warn = console.warn;
  t.after(() => { console.warn = warn; });
  console.warn = () => {};
  for (const value of ['sydney', 'ap-southeast-2; x', 'https://evil.example', '']) {
    process.env.SUPABASE_FUNCTION_REGION = value;
    assert.equal(edgeFunctionRegion(), 'ap-southeast-2', `value ${JSON.stringify(value)}`);
  }
});
