import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedAccountDeleter } from '../lib/social/auth-admin.js';

const selfId = '00000000-0000-4000-8000-000000000011';
const anotherId = '00000000-0000-4000-8000-000000000012';
const administratorId = '00000000-0000-4000-8000-000000000013';
const user = { id: selfId, email: 'self@example.invalid', name: 'Test' };
const environment = {
  NEON_AUTH_BASE_URL: 'https://ep-unit.neonauth.c-1.eu-central-1.aws.neon.tech/mycloset/auth',
  MYCLOSET_AUTH_ADMIN_EMAIL: 'service@example.invalid',
  MYCLOSET_AUTH_ADMIN_PASSWORD: 'unit-test-service-password-only',
};
const input = { user, password: 'unit-user-password', origin: 'http://localhost:3007' };

function response(value, { status = 200, cookie } = {}) {
  return Response.json(value, {
    status,
    headers: cookie ? { 'Set-Cookie': cookie } : {},
  });
}

function makeServer({
  verificationId = selfId,
  adminRole = 'admin',
  passwordInvalid = false,
  removeStatus = 200,
  removeResult = { success: true },
  oversized = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const operation = new URL(url).pathname.split('/auth/')[1];
    const body = JSON.parse(options.body);
    calls.push({ operation, body, options, url: new URL(url) });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Origin, input.origin);
    if (operation === 'sign-in/email' && body.email === user.email) {
      if (passwordInvalid)
        return response(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'private upstream details' },
          { status: 401 },
        );
      if (oversized)
        return new Response('x'.repeat(130 * 1024), {
          headers: { 'Content-Type': 'application/json' },
        });
      return response(
        { user: { id: verificationId, email: user.email } },
        {
          cookie:
            '__Secure-neon-auth.session_token=proof-cookie; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
      );
    }
    if (operation === 'sign-in/email' && body.email === environment.MYCLOSET_AUTH_ADMIN_EMAIL) {
      assert.equal(body.password, environment.MYCLOSET_AUTH_ADMIN_PASSWORD);
      assert.equal(options.headers.Cookie, undefined);
      return response(
        { user: { id: administratorId, role: adminRole } },
        {
          cookie:
            '__Secure-neon-auth.session_token=admin-cookie; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
      );
    }
    if (operation === 'admin/remove-user') {
      assert.equal(options.headers.Cookie, '__Secure-neon-auth.session_token=admin-cookie');
      assert.deepEqual(Object.keys(body), ['userId']);
      return response(removeResult, { status: removeStatus });
    }
    if (operation === 'sign-out')
      return response(
        { success: true },
        { cookie: '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure' },
      );
    throw new Error('Unexpected test operation.');
  };
  return { calls, remove: createManagedAccountDeleter({ environment, fetcher }) };
}

test('optional deletion verifies the current identity and keeps service cookies isolated', async () => {
  const { remove, calls } = makeServer();
  assert.deepEqual(await remove(input), { deleted: true });
  const deletion = calls.find((call) => call.operation === 'admin/remove-user');
  assert.deepEqual(deletion.body, { userId: selfId });
  const logouts = calls.filter((call) => call.operation === 'sign-out');
  assert.equal(logouts.length, 2);
  assert.deepEqual(
    new Set(logouts.map((call) => call.options.headers.Cookie)),
    new Set([
      '__Secure-neon-auth.session_token=proof-cookie',
      '__Secure-neon-auth.session_token=admin-cookie',
    ]),
  );
  assert.ok(calls.every((call) => call.url.hostname.endsWith('.neon.tech')));
});

test('invalid password never starts a service session or an administrative operation', async () => {
  const { remove, calls } = makeServer({ passwordInvalid: true });
  await assert.rejects(
    remove(input),
    (error) =>
      error.status === 401 &&
      error.code === 'INVALID_PASSWORD' &&
      !error.message.includes('private upstream'),
  );
  assert.deepEqual(
    calls.map((call) => call.operation),
    ['sign-in/email'],
  );
});

test('identity mismatch signs out the proof session and never reaches admin login', async () => {
  const { remove, calls } = makeServer({ verificationId: anotherId });
  await assert.rejects(
    remove(input),
    (error) => error.status === 409 && error.code === 'ACCOUNT_CHANGED',
  );
  assert.deepEqual(
    calls.map((call) => call.operation),
    ['sign-in/email', 'sign-out'],
  );
});

test('an ordinary service identity cannot enable native administrative deletion', async () => {
  const { remove, calls } = makeServer({ adminRole: 'user' });
  await assert.rejects(
    remove(input),
    (error) => error.status === 503 && error.code === 'AUTH_ADMIN_ROLE_REQUIRED',
  );
  assert.equal(calls.filter((call) => call.operation === 'admin/remove-user').length, 0);
  assert.equal(calls.filter((call) => call.operation === 'sign-out').length, 2);
});

test('body target overrides and invalid origin are rejected before sending credentials', async () => {
  const { remove, calls } = makeServer();
  await assert.rejects(remove({ ...input, targetId: anotherId }), (error) => error.status === 400);
  await assert.rejects(
    remove({ ...input, origin: 'https://example.invalid/other-path' }),
    (error) => error.code === 'ACCOUNT_DELETE_ORIGIN',
  );
  assert.equal(calls.length, 0);
});

test('service account protects itself before making a network request', async () => {
  const { remove, calls } = makeServer();
  await assert.rejects(
    remove({ ...input, user: { ...user, email: environment.MYCLOSET_AUTH_ADMIN_EMAIL } }),
    (error) => error.code === 'SERVICE_ACCOUNT_PROTECTED',
  );
  assert.equal(calls.length, 0);
});

test('credentials cannot be sent to a modified non-Neon auth host', async () => {
  let fetched = false;
  const remove = createManagedAccountDeleter({
    environment: { ...environment, NEON_AUTH_BASE_URL: 'https://example.invalid/auth' },
    fetcher: async () => {
      fetched = true;
    },
  });
  await assert.rejects(remove(input), (error) => error.code === 'AUTH_ADMIN_NOT_CONFIGURED');
  assert.equal(fetched, false);
});

test('native deletion error signs out both isolated sessions without claiming success', async () => {
  const { remove, calls } = makeServer({
    removeStatus: 503,
    removeResult: { code: 'ERROR', message: environment.MYCLOSET_AUTH_ADMIN_PASSWORD },
  });
  await assert.rejects(
    remove(input),
    (error) =>
      error.code === 'ACCOUNT_DELETE_UNCONFIRMED' &&
      !error.message.includes(environment.MYCLOSET_AUTH_ADMIN_PASSWORD),
  );
  assert.equal(calls.filter((call) => call.operation === 'sign-out').length, 2);
});

test('a malformed success response cannot be reported as account deletion', async () => {
  const { remove, calls } = makeServer({ removeResult: { success: false } });
  await assert.rejects(remove(input), (error) => error.code === 'ACCOUNT_DELETE_UNCONFIRMED');
  assert.equal(calls.filter((call) => call.operation === 'sign-out').length, 2);
});

test('oversized native responses are rejected before any administrative session', async () => {
  const { remove, calls } = makeServer({ oversized: true });
  await assert.rejects(remove(input), (error) => error.code === 'ACCOUNT_REAUTH_UNAVAILABLE');
  assert.equal(calls.filter((call) => call.operation === 'admin/remove-user').length, 0);
});
