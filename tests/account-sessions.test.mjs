import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSessionHandlers } from '../lib/cloud/account-sessions.js';
import { createAuthServer, resolveNeonAuthLogging } from '@neondatabase/auth/server';

const origin = 'https://closet.example';
const request = (body, headers = {}, method = body ? 'POST' : 'GET') => new Request(`${origin}/api/account/sessions`, {
  method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-MyCloset-Account': 'owner', ...headers },
  ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const entry = (id, extra = {}) => ({ id, userId: 'owner', token: `SECRET-${id}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', userAgent: 'Browser', ipAddress: '127.0.0.1', ...extra });
function fixture(overrides = {}) {
  const calls = [];
  const api = createAccountSessionHandlers({
    configured: () => true,
    getUser: async () => ({ id: 'owner', emailVerified: false }),
    getSession: async () => ({ data: { user: { id: 'owner' }, session: { id: 'current' } } }),
    listSessions: async () => ({ data: [entry('current'), entry('other'), entry('second')] }),
    revokeSession: async (token) => { calls.push(token); return { data: { status: true } }; },
    ...overrides,
  });
  return { api, calls };
}
test('session DTO exposes only own safe metadata, current marker and no credential tokens', async () => {
  const { api } = fixture();
  const response = await api.GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  const text = await response.text();
  assert.doesNotMatch(text, /SECRET|token|userId/);
  const { sessions } = JSON.parse(text);
  assert.equal(sessions.length, 3);
  assert.equal(sessions.filter((session) => session.current).length, 1);
  assert.equal(sessions[0].id, 'current');
});
test('revoke-others uses official individual revocations and excludes current session', async () => {
  const { api, calls } = fixture();
  const response = await api.POST(request({ action: 'revoke-others' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: 2 });
  assert.deepEqual(calls, ['SECRET-other', 'SECRET-second']);
});
test('individual revocation cannot target current or someone else’s id/token', async () => {
  const { api, calls } = fixture();
  assert.equal((await api.POST(request({ action: 'revoke', sessionId: 'other' }))).status, 200);
  assert.equal((await api.POST(request({ action: 'revoke', sessionId: 'current' }))).status, 400);
  assert.equal((await api.POST(request({ action: 'revoke', sessionId: 'foreign' }))).status, 404);
  assert.deepEqual(calls, ['SECRET-other']);
});
test('revoked identity, stale account scope and upstream cross-user records fail closed', async () => {
  const missing = fixture({ getUser: async () => null });
  assert.equal((await missing.api.GET(request())).status, 401);
  const normal = fixture();
  assert.equal((await normal.api.POST(request({ action: 'revoke-others' }, { 'X-MyCloset-Account': 'old-owner' }))).status, 409);
  const foreign = fixture({ listSessions: async () => ({ data: [entry('current'), entry('other', { userId: 'foreign' })] }) });
  assert.equal((await foreign.api.POST(request({ action: 'revoke-others' }))).status, 503);
  assert.deepEqual(foreign.calls, []);
  const currentGone = fixture({ listSessions: async () => ({ data: [entry('other')] }) });
  assert.equal((await currentGone.api.GET(request())).status, 401);
});
test('invalid origin, oversized body and elevated payloads never revoke a session', async () => {
  const { api, calls } = fixture();
  assert.equal((await api.POST(request({ action: 'revoke-others' }, { Origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await api.POST(request({ action: 'revoke-others', userId: 'foreign' }))).status, 400);
  assert.equal((await api.POST(request({ action: 'revoke', token: 'SECRET-other' }))).status, 400);
  assert.equal((await api.POST(request('x'.repeat(1025)))).status, 413);
  assert.equal((await api.POST(request('{'))).status, 400);
  assert.deepEqual(calls, []);
});
test('partial upstream failure reports the confirmed count without leaking errors or tokens', async () => {
  let call = 0;
  const { api } = fixture({ revokeSession: async () => ++call === 1 ? { data: { status: true } } : { error: { message: 'SECRET-upstream' } } });
  const response = await api.POST(request({ action: 'revoke-others' }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.revoked, 1);
  assert.equal(body.code, 'SESSION_REVOKE_PARTIAL');
  assert.doesNotMatch(JSON.stringify(body), /SECRET/);
});

test('installed Managed SDK lists sessions and revokes only selected own token at the exact supported endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url).endsWith('/list-sessions')
      ? Response.json([entry('current'), entry('other')]) : Response.json({ status: true });
  };
  try {
    const sdk = createAuthServer({
      baseUrl: 'https://managed-fixture.invalid/branch/auth',
      cookieSecret: 'fixture-secret-for-installed-sdk-longer-than-32-chars',
      log: resolveNeonAuthLogging({ logLevel: 'silent' }),
      context: () => ({
        getCookies: () => '__Secure-neon-auth.session_token=fixture-only-cookie',
        getOrigin: () => origin, getHeader: () => null, getFramework: () => 'nextjs', setCookie: () => {},
      }),
    });
    const { api } = fixture({ listSessions: () => sdk.listSessions(), revokeSession: (token) => sdk.revokeSession({ token }) });
    const response = await api.POST(request({ action: 'revoke-others' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revoked: 1 });
    assert.deepEqual(calls.map((call) => [call.url, call.options.method]), [
      ['https://managed-fixture.invalid/branch/auth/list-sessions', 'GET'],
      ['https://managed-fixture.invalid/branch/auth/revoke-session', 'POST'],
    ]);
    assert.equal(new Headers(calls[0].options.headers).get('Origin'), origin);
    assert.match(new Headers(calls[0].options.headers).get('Cookie'), /fixture-only-cookie/);
    assert.deepEqual(JSON.parse(calls[1].options.body), { token: 'SECRET-other' });
    assert.equal(calls.some((call) => call.url.includes('revoke-all-sessions')), false);
  } finally { globalThis.fetch = originalFetch; }
});
