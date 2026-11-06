import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthProxyRequest, resolveNeonAuthLogging } from '@neondatabase/auth/server';
import { createAuthClient } from '@neondatabase/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/auth/vanilla';
import { createAuthHandlers } from '../lib/cloud/auth-handlers.js';
import { normalizeEmailAddress, validateRegistrationInput } from '../lib/cloud/email-validation.js';

const origin = 'https://closet.example';
const trackedRequest = (request) => new Proxy(request, {
  get(target, key) {
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

test('normalized tracked requests reach the installed official SDK at the correct endpoint with method and origin intact', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    // No real account or session is created: the entire upstream is a fixture.
    return Response.json({ code: 'INVALID_PASSWORD', message: 'Intentional no-write fixture' }, { status: 400 });
  };
  try {
    const failures = [];
    const api = createAuthHandlers({
      configured: () => true,
      validateRegistrationInput,
      normalizeEmailAddress,
      validateEmailDomain: async () => {},
      // The Next.js adapter delegates to this public SDK proxy engine. Using it
      // directly avoids bootstrapping a Next server in Node's test runner.
      proxy: async (_method, request, context) => handleAuthProxyRequest({
        request,
        path: (await context.params).path.join('/'),
        baseUrl: 'https://auth-fixture.invalid/mycloset/auth',
        cookieSecret: 'local-test-fixture-secret-longer-than-32-characters',
        sessionDataTtl: 60,
        log: resolveNeonAuthLogging({ logLevel: 'silent' }),
      }),
      report: (code) => failures.push(code),
    });
    const incoming = trackedRequest(new Request(`${origin}/api/auth/sign-up/email?flow=test`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Host: 'closet.example',
        'Content-Type': 'application/json',
        'X-Untrusted-Header': 'not-forwarded',
      },
      body: JSON.stringify({ name: '  SDK Probe  ', email: ' SDK.PROBE@GMAIL.COM ', password: 'FixturePassword9!' }),
    }));
    const response = await api.POST(incoming, {
      params: Promise.resolve({ path: ['sign-up', 'email'] }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'INVALID_PASSWORD', message: 'Intentional no-write fixture' });
    assert.deepEqual(failures, []);
    assert.equal(calls.length, 1);
    const { url, options } = calls[0];
    assert.equal(url, 'https://auth-fixture.invalid/mycloset/auth/sign-up/email?flow=test');
    assert.equal(options.method, 'POST');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Origin'), origin);
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('x-neon-auth-middleware'), 'true');
    assert.equal(headers.has('X-Untrusted-Header'), false);
    assert.deepEqual(JSON.parse(options.body), {
      name: 'SDK Probe', email: 'sdk.probe@gmail.com', password: 'FixturePassword9!',
    });
    assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK feature_not_supported also represents local HTTP 403 and 503 failures, independent of signup configuration', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, code] of [[403, 'INVALID_ORIGIN'], [503, 'AUTH_UNAVAILABLE']]) {
      globalThis.fetch = async () => Response.json({ code, message: 'Public fixture failure' }, { status });
      const client = createAuthClient(`https://client-fixture.invalid/${status}/auth`, {
        adapter: BetterAuthVanillaAdapter(),
      });
      await assert.rejects(
        client.signUp.email({ name: 'SDK Probe', email: 'sdk.probe@gmail.com', password: 'FixturePassword9!' }),
        (error) => error.code === 'feature_not_supported' && error.status === status,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
