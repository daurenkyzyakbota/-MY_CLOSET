import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationCron, dispatchConfiguration } from '../index.js';

const environment = {
  MYCLOSET_NOTIFICATION_DISPATCH_URL: 'https://wardrobe.example/api/notifications/dispatch',
  MYCLOSET_NOTIFICATION_CRON_SECRET: 'fixture-only-server-secret-32-characters-minimum',
};
const payload = (fields = {}) => ({
  version: 1, invocation_id: 'fixture-occurrence-1',
  trigger: { type: 'schedule', id: 'trigger-fixture', name: 'Every minute' },
  data: { scheduled_at: '2026-11-06T10:00:00Z' },
  previous_attempts: [], previous_attempts_omitted: 0,
  ...fields,
});
function request(body = payload(), headers = {}, path = '/cron', method = 'POST') {
  return new Request(`https://function.example${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Neon-Trigger-Invocation-Id': 'fixture-occurrence-1', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
function fixture(overrides = {}) {
  const calls = [];
  const reports = [];
  const app = createNotificationCron({
    environment: () => environment,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response('fixture response', { status: 200 }); },
    report: (event) => reports.push(event),
    ...overrides,
  });
  return { app, calls, reports };
}

test('missing, wrong reserved header and mismatched invocation are unauthorized before any downstream fetch', async () => {
  let environmentReads = 0;
  const { app, calls } = fixture({ environment: () => { environmentReads++; return environment; } });
  const missing = request(); missing.headers.delete('x-neon-trigger-invocation-id');
  const response = await app.fetch(missing);
  assert.equal(response.status, 401);
  assert.equal(missing.bodyUsed, false);
  const invented = request(); invented.headers.delete('x-neon-trigger-invocation-id'); invented.headers.set('x-neon-invocation-id', 'fixture-occurrence-1');
  assert.equal((await app.fetch(invented)).status, 401);
  assert.equal((await app.fetch(request(payload(), { 'X-Neon-Trigger-Invocation-Id': 'different' }))).status, 401);
  assert.equal(environmentReads, 0);
  assert.deepEqual(calls, []);
});

test('a public fake header stripped by the documented Neon edge cannot authorize a trigger', async () => {
  const { app, calls } = fixture();
  const publicRequest = request();
  // The native deployed proxy performs this stripping. The SDK deliberately
  // trusts provenance after the proxy, not an invocation-ID shared secret.
  for (const key of [...publicRequest.headers.keys()]) if (key.startsWith('x-neon-')) publicRequest.headers.delete(key);
  assert.equal((await app.fetch(publicRequest)).status, 401);
  assert.deepEqual(calls, []);
});

test('official parser accepts a schedule without user auth and forwards an empty POST only to the configured target', async () => {
  const { app, calls } = fixture();
  const incoming = request(payload({ target: 'https://attacker.example/steal' }), { Cookie: 'untrusted-cookie' });
  const response = await app.fetch(incoming);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, environment.MYCLOSET_NOTIFICATION_DISPATCH_URL);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.redirect, 'manual');
  const headers = new Headers(calls[0].options.headers);
  assert.equal(headers.get('Authorization'), `Bearer ${environment.MYCLOSET_NOTIFICATION_CRON_SECRET}`);
  assert.equal(headers.get('Content-Length'), '0');
  assert.equal(headers.has('Cookie'), false);
  assert.equal(headers.has('X-Secret'), false);
});

test('unknown routes and methods never dispatch or inspect credentials', async () => {
  const { app, calls } = fixture({ environment: () => { throw new Error('Must not read environment'); } });
  assert.equal((await app.fetch(request(undefined, {}, '/'))).status, 404);
  const response = await app.fetch(request(undefined, {}, '/cron', 'GET'));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.deepEqual(calls, []);
});

test('bounded JSON and strict schedule validation reject malformed and storage-event deliveries', async () => {
  const { app, calls } = fixture();
  const cases = [
    [request('{'), 400],
    [request(payload({ version: 2 })), 400],
    [request(payload({ data: { scheduled_at: '2026-02-30T00:00:00Z' } })), 400],
    [request(payload({ data: { scheduled_at: 'not-a-date' } })), 400],
    [request(payload({ trigger: { type: 'storage_object_created', id: 'storage', name: 'upload' }, data: { bucket_name: 'uploads', object_key: 'one.png' } })), 400],
    [request(payload(), { 'Content-Type': 'text/plain' }), 415],
    [request(payload(), { 'Content-Length': '65537' }), 413],
    [request('x'.repeat(65537)), 413],
    [request(payload({ invocation_id: 'x'.repeat(257) }), { 'X-Neon-Trigger-Invocation-Id': 'x'.repeat(257) }), 400],
  ];
  for (const [incoming, expected] of cases) assert.equal((await app.fetch(incoming)).status, expected);
  assert.deepEqual(calls, []);
});

test('bounded retry history is accepted but not forwarded to the application', async () => {
  const { app, calls } = fixture();
  const body = payload({
    previous_attempts: Array.from({ length: 16 }, () => ({ status_code: 503, timestamp: '2026-11-06T09:59:00Z', response_body: 'x'.repeat(1024), response_body_truncated: true })),
    previous_attempts_omitted: 2,
  });
  assert.equal((await app.fetch(request(body))).status, 200);
  assert.equal(calls[0].options.body, undefined);
});

test('all downstream failures and redirects produce a generic retryable 503 without following or revealing response bodies', async () => {
  for (const status of [301, 302, 307, 401, 429, 500, 503]) {
    let canceled = false;
    let calls = 0;
    const { app } = fixture({ fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status, headers: { Location: 'https://attacker.example/', 'X-Secret-Response': 'private' } });
    } });
    const response = await app.fetch(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(response.headers.has('Location'), false);
    assert.deepEqual(await response.json(), { ok: false, error: 'dispatch_unavailable' });
    assert.equal(calls, 1);
    assert.equal(canceled, true);
  }
});

test('outbound timeout and transport exceptions remain retryable and never expose exception details', async () => {
  let aborted = false;
  const { app } = fixture({ timeoutMs: 5, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('SECRET transport address')); }, { once: true });
  }) });
  const response = await app.fetch(request());
  assert.equal(aborted, true);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SECRET|address/);
  const failure = fixture({ fetchImpl: async () => { throw new Error('SECRET other failure'); } });
  assert.equal((await failure.app.fetch(request())).status, 503);
});

test('missing secrets and unsafe dispatch configuration fail closed without requests', async () => {
  for (const address of [
    'http://wardrobe.example/api/notifications/dispatch',
    'https://wardrobe.example/other',
    'https://wardrobe.example/api/notifications/dispatch?secret=private',
    'https://user:password@wardrobe.example/api/notifications/dispatch',
    'https://127.0.0.1/api/notifications/dispatch',
    'https://wardrobe.example:8443/api/notifications/dispatch',
  ]) assert.equal(dispatchConfiguration({ ...environment, MYCLOSET_NOTIFICATION_DISPATCH_URL: address }), null);
  assert.equal(dispatchConfiguration({ ...environment, MYCLOSET_NOTIFICATION_CRON_SECRET: '' }), null);
  const { app, calls } = fixture({ environment: () => ({}) });
  assert.equal((await app.fetch(request())).status, 503);
  assert.deepEqual(calls, []);
});

test('native microseconds and up to nine fractional digits are accepted while invalid calendar dates remain rejected', async () => {
  const { app, calls } = fixture();
  for (const fraction of ['1', '12', '123', '1234', '12345', '123456', '1234567', '12345678', '123456789'])
    assert.equal((await app.fetch(request(payload({ data: { scheduled_at: `2026-11-07T00:05:00.${fraction}Z` } })))).status, 200);
  for (const scheduled_at of ['2026-11-07T00:05:00.1234567890Z', '2026-02-30T00:05:00.123456Z', '2026-11-07T24:05:00.123456Z'])
    assert.equal((await app.fetch(request(payload({ data: { scheduled_at } })))).status, 400);
  assert.equal(calls.length, 9);
});

test('rejection telemetry never includes trigger payload, header values or credentials', async () => {
  const { app, reports, calls } = fixture();
  const missing = request(payload({ private: 'PRIVATE_PAYLOAD' }), { Authorization: 'Bearer PRIVATE_HEADER' });
  missing.headers.delete('x-neon-trigger-invocation-id');
  assert.equal((await app.fetch(missing)).status, 401);
  assert.equal((await app.fetch(request('{PRIVATE_BODY'))).status, 400);
  assert.equal((await app.fetch(request(payload(), { 'X-Neon-Trigger-Invocation-Id': 'PRIVATE_MISMATCH' }))).status, 401);
  assert.equal((await app.fetch(request(payload({ data: { scheduled_at: 'PRIVATE_SCHEDULE' } })))).status, 400);
  assert.deepEqual(reports, [
    { phase: 'provenance_rejected', status: 401 },
    { phase: 'body_rejected', status: 400 },
    { phase: 'parser_rejected', status: 401 },
    { phase: 'schedule_rejected', status: 400 },
  ]);
  assert.doesNotMatch(JSON.stringify(reports), /PRIVATE|fixture|Bearer|Every minute/);
  assert.deepEqual(calls, []);
});

test('downstream status and generic retries are logged without body, target or exception details', async () => {
  const success = fixture();
  assert.equal((await success.app.fetch(request())).status, 200);
  assert.deepEqual(success.reports, [{ phase: 'downstream', status: 200 }]);
  const failure = fixture({ fetchImpl: async () => new Response('PRIVATE_BODY', { status: 403 }) });
  assert.equal((await failure.app.fetch(request())).status, 503);
  assert.deepEqual(failure.reports, [{ phase: 'downstream', status: 403 }]);
  const network = fixture({ fetchImpl: async () => { throw new Error('PRIVATE_EXCEPTION'); } });
  assert.equal((await network.app.fetch(request())).status, 503);
  assert.deepEqual(network.reports, [{ phase: 'network_retry', status: 503 }]);
  const missing = fixture({ environment: () => ({}) });
  assert.equal((await missing.app.fetch(request())).status, 503);
  assert.deepEqual(missing.reports, [{ phase: 'configuration_retry', status: 503 }]);
  assert.doesNotMatch(JSON.stringify([...success.reports, ...failure.reports, ...network.reports, ...missing.reports]), /PRIVATE|https|Bearer|secret|fixture/);
});

test('default console reporter contains only phase and status; reporter exceptions cannot bypass auth or change successful delivery', async () => {
  const originalInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args);
  try {
    const app = createNotificationCron({ environment: () => environment, fetchImpl: async () => new Response('PRIVATE_BODY', { status: 200 }) });
    assert.equal((await app.fetch(request())).status, 200);
  } finally { console.info = originalInfo; }
  assert.equal(messages.length, 1);
  assert.equal(messages[0].length, 1);
  assert.deepEqual(JSON.parse(messages[0][0]), { phase: 'downstream', status: 200 });
  const { app, calls } = fixture({ report: () => { throw new Error('PRIVATE_LOG_FAILURE'); } });
  const missing = request(); missing.headers.delete('x-neon-trigger-invocation-id');
  assert.equal((await app.fetch(missing)).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await app.fetch(request())).status, 200);
  assert.equal(calls.length, 1);
});
