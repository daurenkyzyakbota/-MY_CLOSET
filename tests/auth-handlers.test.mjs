import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandlers } from '../lib/cloud/auth-handlers.js';
import { normalizeEmailAddress, validateRegistrationInput } from '../lib/cloud/email-validation.js';

const origin = 'https://closet.example';
const context = (path) => ({ params: Promise.resolve({ path: path.split('/') }) });
const signup = (body, headers = {}) => new Request(`${origin}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const valid = () => ({ name: '  Имя  ', email: '  TEST+tag@GMAIL.COM  ', password: 'Password!9' });
function fixture(overrides = {}) {
  const calls = { domains: [], proxy: [] };
  const api = createAuthHandlers({
    configured: () => true,
    validateRegistrationInput,
    normalizeEmailAddress,
    validateEmailDomain: async (domain) => calls.domains.push(domain),
    proxy: async (method, request) => {
      calls.proxy.push({ method, request, body: await request.json() });
      return Response.json({ accepted: true });
    },
    ...overrides,
  });
  return { api, calls };
}

test('signup checks origin, content type and declared/streamed bounds before DNS or auth', async () => {
  for (const [request, status] of [
    [signup(valid(), { Origin: 'https://other.example' }), 403],
    [signup(valid(), { 'Content-Type': 'text/plain' }), 415],
    [signup(valid(), { 'Content-Length': '9000' }), 413],
    [signup(valid(), { 'Content-Length': 'invalid' }), 413],
    [signup(' '.repeat(8193)), 413],
    [signup('{bad'), 400],
  ]) {
    const { api, calls } = fixture();
    const response = await api.POST(request, context('sign-up/email'));
    assert.equal(response.status, status);
    assert.equal(calls.domains.length, 0);
    assert.equal(calls.proxy.length, 0);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
});

test('reserved and malformed addresses cannot reach DNS or upstream account creation', async () => {
  for (const email of ['test@example.invalid', 'test@example.com', 'broken', 'a..b@gmail.com']) {
    const { api, calls } = fixture();
    const response = await api.POST(signup({ ...valid(), email }), context('sign-up/email'));
    assert.ok([400, 422].includes(response.status));
    assert.equal(calls.domains.length, 0);
    assert.equal(calls.proxy.length, 0);
    const body = await response.json();
    assert.ok(body.code);
    assert.ok(body.message);
  }
});

test('normalized signup preserves SDK options and password while leaving original body readable', async () => {
  const { api, calls } = fixture();
  const body = { ...valid(), callbackURL: `${origin}/account`, rememberMe: true };
  const request = signup(body);
  const response = await api.POST(request, context('sign-up/email'));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.domains, ['gmail.com']);
  assert.deepEqual(calls.proxy[0].body, { ...body, email: 'test+tag@gmail.com', name: 'Имя' });
  assert.deepEqual(await request.json(), body);
});

test('signup forwards a framework tracking Proxy as a fresh native request with its URL, method, headers and cancellation', async () => {
  const { api, calls } = fixture();
  const body = { ...valid(), callbackURL: `${origin}/account`, rememberMe: false };
  const serialized = JSON.stringify(body);
  const abort = new AbortController();
  const original = new Request(`${origin}/api/auth/sign-up/email?source=account`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(serialized)),
      Cookie: 'signed-session=opaque',
      'X-Request-Id': 'proxy-regression',
    },
    body: serialized,
    signal: abort.signal,
    redirect: 'manual',
  });
  // This is the same bound-accessor Proxy shape used by route tracking in
  // Vinext. It is readable but lacks the native Request constructor's brand.
  const tracked = new Proxy(original, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const response = await api.POST(tracked, context('sign-up/email'));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.domains, ['gmail.com']);
  assert.equal(calls.proxy.length, 1);
  const forwarded = calls.proxy[0].request;
  assert.equal(calls.proxy[0].method, 'POST');
  assert.notEqual(forwarded, tracked);
  assert.ok(forwarded instanceof Request);
  assert.equal(forwarded.url, original.url);
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.redirect, 'manual');
  assert.equal(forwarded.headers.get('origin'), origin);
  assert.equal(forwarded.headers.get('cookie'), 'signed-session=opaque');
  assert.equal(forwarded.headers.get('x-request-id'), 'proxy-regression');
  assert.equal(forwarded.headers.get('content-length'), null);
  assert.deepEqual(calls.proxy[0].body, { ...body, email: 'test+tag@gmail.com', name: 'Имя' });
  assert.deepEqual(await original.json(), body);
  assert.equal(forwarded.signal.aborted, false);
  abort.abort();
  assert.equal(forwarded.signal.aborted, true);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
});

test('temporary DNS failures return a retryable error without creating an account', async () => {
  const { api, calls } = fixture({
    validateEmailDomain: async () => {
      throw Object.assign(new Error('Проверка почты временно недоступна.'), {
        status: 503, code: 'EMAIL_DNS_UNAVAILABLE', retryAfter: 15,
      });
    },
  });
  const response = await api.POST(signup(valid()), context('sign-up/email'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '15');
  assert.equal((await response.json()).code, 'EMAIL_DNS_UNAVAILABLE');
  assert.equal(calls.proxy.length, 0);
});

test('session proxy preserves unverified sessions and signed cookies without mandatory verification', async () => {
  const value = { user: { id: 'user', emailVerified: false }, session: { id: 'session' } };
  const headers = new Headers({ Vary: 'Accept-Encoding' });
  headers.append('Set-Cookie', 'signed-session=one; Secure; HttpOnly; SameSite=Lax');
  headers.append('Set-Cookie', 'signed-data=two; Secure; HttpOnly; SameSite=Lax');
  const { api } = fixture({ proxy: async () => Response.json(value, { headers }) });
  const response = await api.GET(
    new Request(`${origin}/api/auth/get-session`),
    context('get-session'),
  );
  assert.deepEqual(await response.json(), value);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.get('Vary'), 'Accept-Encoding, Cookie');
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
});

test('proxy failures do not expose infrastructure details and raw account deletion stays blocked', async () => {
  const { api, calls } = fixture({
    proxy: async () => { throw new Error('Secret connection details'); },
  });
  const response = await api.GET(new Request(`${origin}/api/auth/get-session`), context('get-session'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /Secret/);
  const deletion = await api.POST(signup({}), context('delete-user'));
  assert.equal(deletion.status, 400);
  assert.equal(calls.proxy.length, 0);
});
