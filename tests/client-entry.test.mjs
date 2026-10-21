import test from 'node:test';
import assert from 'node:assert/strict';
import { clientEntry } from '../lib/client-entry.ts';

const portal = 'https://magickeys-balwyn-portal.com';
function form({ origin = 'https://www.magickeys.com.au', body = 'username=approved%40example.test&password=Test%2BOnly%26%3D', headers = {} } = {}) {
  return new Request(portal + '/api/auth/client-entry', { method: 'POST', body, headers: {
    origin, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
    'user-agent': 'Fixture browser', 'cf-connecting-ip': '192.0.2.20', ...headers,
  } });
}

test('rejects untrusted, absent and lookalike origins before checking credentials', async () => {
  for (const origin of ['https://attacker.example', 'https://www.magickeys.com.au.attacker.example', 'null', '']) {
    let called = false;
    const response = await clientEntry(form({ origin }), async () => { called = true; return Response.json({}); }, portal);
    assert.equal(response.status, 403); assert.equal(called, false);
  }
});

test('rejects non-navigation requests, wrong content type and untrusted public host', async () => {
  for (const headers of [{ 'sec-fetch-mode': 'cors' }, { 'sec-fetch-dest': 'iframe' }, { 'content-type': 'application/json' }]) {
    const response = await clientEntry(form({ headers }), () => assert.fail('must not authenticate'), portal);
    assert.equal(response.status, 403);
  }
  assert.equal((await clientEntry(form(), () => assert.fail(), 'https://other.example')).status, 403);
});

test('bounds both declared and streamed bodies and rejects duplicate or empty fields', async () => {
  for (const options of [
    { body: 'username=a&username=b&password=p' }, { body: 'username=a&password=p&password=q' },
    { body: 'username=&password=p' }, { body: 'username=a&password=' },
    { body: 'username=a&password=' + 'x'.repeat(1025) },
    { body: 'username=a&password=p', headers: { 'content-length': '8193' } },
    { body: 'username=a&password=p&padding=' + 'x'.repeat(8192) },
  ]) {
    const response = await clientEntry(form(options), () => assert.fail('invalid input reached auth'), portal);
    assert.equal(response.status, 303); assert.match(response.headers.get('location'), /signin=failed$/);
  }
});

test('preserves credentials, IP and agent for existing auth and resumes MFA without leaking secrets', async () => {
  const cookie = 'balwyn_operator_mfa=signed-fixture; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600';
  const response = await clientEntry(form({ headers: { cookie: 'old-session=unused' } }), async request => {
    assert.equal(request.url, portal + '/api/auth/email');
    assert.deepEqual(await request.json(), { email: 'approved@example.test', password: 'Test+Only&=' });
    assert.equal(request.headers.get('cf-connecting-ip'), '192.0.2.20');
    assert.equal(request.headers.get('user-agent'), 'Fixture browser');
    assert.equal(request.headers.get('cookie'), null);
    assert.equal(request.headers.get('origin'), portal);
    assert.equal(request.headers.get('sec-fetch-site'), 'same-origin');
    return Response.json({ requiresAuthenticator: true, enrollment: { secret: 'NEVER-IN-URL' } }, { headers: { 'Set-Cookie': cookie } });
  }, portal);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), portal + '/login?signin=client-mfa');
  assert.deepEqual(response.headers.getSetCookie(), [cookie]);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('only an authenticated view-only session continues without MFA', async () => {
  const cookie = 'balwyn_operator_session=signed-fixture; Path=/; HttpOnly; Secure; SameSite=Strict';
  const response = await clientEntry(form(), async () => Response.json({ snapshot: { user: { role: 'viewer' } } }, { headers: { 'Set-Cookie': cookie } }), portal);
  assert.equal(response.headers.get('location'), portal + '/login');
  assert.deepEqual(response.headers.getSetCookie(), [cookie]);
});

test('failed accounts never reach a workspace and errors never expose credentials', async () => {
  for (const [status, state] of [[401, 'failed'], [429, 'retry'], [503, 'unavailable']]) {
    const response = await clientEntry(form(), async () => Response.json({ error: 'private diagnostic' }, { status }), portal);
    assert.equal(response.headers.get('location'), 'https://www.magickeys.com.au/client-login/?signin=' + state);
    assert.equal(await response.text(), '');
  }
  for (const handler of [async () => { throw Error('private diagnostic'); }, async () => Response.json({})]) {
    const response = await clientEntry(form(), handler, portal);
    assert.match(response.headers.get('location'), /signin=unavailable$/);
  }
});
