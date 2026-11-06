import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationError, pushEndpoint, pushSubscription, notificationPreferences, genericPush } from '../lib/notifications/validation.js';
import { sendWebPush } from '../lib/notifications/web-push.js';
import { createNotificationHandlers } from '../lib/notifications/handlers.js';
import { createSocialService } from '../lib/social/service.js';
import { createNotificationService } from '../lib/notifications/service.js';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { browserNotificationEnabled, disconnectBrowserNotifications, enableBrowserNotifications } from '../lib/notifications/browser-client.js';

const user = { id: 'f9391930-aeed-43c9-bc52-c12792d9253a' };
const sessionId = '531fa670-e5a7-4abb-8564-caf60141d6fb';
const base64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function subscription() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-test', expirationTime: null,
    keys: { p256dh: base64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: base64url(crypto.getRandomValues(new Uint8Array(16))) } };
}

test('push endpoints reject SSRF hosts, credentials, ports, lookalike domains and redirects', async () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/id', 'https://fcm.googleapis.com.evil.invalid/send',
    'https://127.0.0.1/private', 'https://169.254.169.254/latest', 'https://user:password@fcm.googleapis.com/send',
    'https://fcm.googleapis.com:444/send', 'https://notify.windows.com.evil.invalid/id',
  ]) assert.throws(() => pushEndpoint(endpoint), NotificationError);
  assert.equal(pushEndpoint('https://web.push.apple.com/token'), 'https://web.push.apple.com/token');
  assert.equal(pushEndpoint('https://wns2.notify.windows.com/w/?token=opaque'), 'https://wns2.notify.windows.com/w/?token=opaque');
  let calls = 0;
  const result = await sendWebPush(await subscription(), { title: 'MyCloset' }, {
    configuration: { available: true }, build: async () => ({ method: 'POST', body: 'encrypted' }),
    fetcher: async (_url, options) => { calls++; assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
});

test('subscription validation verifies actual curve points, secret lengths, expiration and unknown fields', async () => {
  const value = await subscription();
  assert.deepEqual(await pushSubscription(value), value);
  for (const bad of [
    { ...value, userId: 'another-user' }, { ...value, expirationTime: Date.now() - 1 },
    { ...value, keys: { ...value.keys, auth: 'bad' } },
    { ...value, keys: { ...value.keys, p256dh: base64url(new Uint8Array(65)) } },
  ]) await assert.rejects(pushSubscription(bad), NotificationError);
});

test('notification choices are explicit, timezone-aware and reject string booleans or elevated fields', () => {
  const value = { messages: true, outfits: false, timeZone: 'Asia/Qyzylorda', reminderHour: 20 };
  assert.deepEqual(notificationPreferences(value), value);
  for (const bad of [
    { ...value, messages: 'true' }, { ...value, reminderHour: 24 }, { ...value, timeZone: 'Not/AZone' },
    { ...value, userId: 'another-user' },
  ]) assert.throws(() => notificationPreferences(bad), NotificationError);
});

test('lock-screen payloads contain no message text, actor name, outfit name or photo', () => {
  const secrets = { text: 'private text', name: 'private person', title: 'private outfit', photo: 'data:image/png;secret' };
  for (const payload of [genericPush('message', { ...secrets, messageId: 'id', conversationId: 'conversation' }),
    genericPush('outfit', { ...secrets, date: '2026-11-07' })]) {
    for (const secret of Object.values(secrets)) assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.ok(payload.url.startsWith('/'));
  }
});

test('real WebCrypto encryption creates RFC aes128gcm/VAPID transport and classifies dead subscriptions', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const key = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const config = { available: true, publicKey: base64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: key.d, subject: 'https://mycloset.test' };
  let calls = 0;
  const result = await sendWebPush(await subscription(), genericPush('message', { messageId: 'id', conversationId: 'conversation' }), {
    configuration: config,
    fetcher: async (_endpoint, options) => {
      calls++;
      const headers = new Headers(options.headers);
      assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
      assert.match(headers.get('Authorization'), /^vapid /);
      assert.equal(options.body.byteLength, 4096);
      assert.equal(Buffer.from(options.body).includes(Buffer.from('У вас новое сообщение.')), false);
      return new Response(null, { status: 410 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'expired');
});

function fixture() {
  const calls = [];
  const service = Object.fromEntries(['preferences', 'savePreferences', 'subscribe', 'unsubscribe', 'dispatch'].map((action) =>
    [action, async (...args) => { calls.push({ action, args }); return { ok: true }; }]));
  return { calls, ...createNotificationHandlers({ getUser: async () => user, service, cronSecret: () => 's'.repeat(48) }) };
}
const request = (path, method = 'GET', body, headers = {}) => new Request('https://mycloset.test/api/notifications/' + path, {
  method, headers: { Origin: 'https://mycloset.test', 'X-MyCloset-Account': user.id, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('notification settings and subscriptions require the verified matching account and same origin', async () => {
  const api = fixture();
  for (const headers of [{ 'X-MyCloset-Account': 'other' }, { 'X-MyCloset-Account': '' }])
    assert.equal((await api.preferences.GET(request('preferences', 'GET', null, headers))).status, 409);
  assert.equal((await api.subscriptions.POST(request('subscriptions', 'POST', {}, { Origin: 'https://evil.invalid' }))).status, 403);
  assert.equal(api.calls.length, 0);
  const response = await api.preferences.GET(request('preferences'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  assert.equal(api.calls[0].args[0], user.id);
});

test('cron dispatch rejects missing/wrong credentials without touching the database, and never echoes the secret', async () => {
  const api = fixture();
  for (const authorization of ['', 'Bearer wrong', 's'.repeat(48)]) {
    const response = await api.dispatch.POST(request('dispatch', 'POST', null, { Authorization: authorization }));
    assert.equal(response.status, 401);
    assert.equal((await response.text()).includes('s'.repeat(48)), false);
  }
  assert.equal(api.calls.length, 0);
  assert.equal((await api.dispatch.POST(request('dispatch', 'POST', null, { Authorization: 'Bearer ' + 's'.repeat(48) }))).status, 200);
  assert.deepEqual(api.calls.map(({ action }) => action), ['dispatch']);
});

test('push failures happen after social commit and connection release and never roll back a successful mutation', async () => {
  const events = [];
  const connection = { query: async (sql) => { events.push(sql); return { rows: [] }; }, release: () => events.push('release') };
  const service = createSocialService({ pool: { connect: async () => connection },
    afterCommit: async () => { events.push('push'); throw new Error('provider unavailable'); }, report: (code) => events.push(code) });
  assert.deepEqual(await service.execute('account.delete', {}, user), { ok: true });
  assert.ok(events.indexOf('COMMIT') < events.indexOf('release'));
  assert.ok(events.indexOf('release') < events.indexOf('push'));
  assert.equal(events.includes('ROLLBACK'), false);
  assert.equal(events.at(-1), 'SOCIAL_NOTIFICATION_FAILED');
});

test('an authenticated account cannot take another account’s private browser subscription', async () => {
  const events = [];
  const connection = {
    query: async (sql) => {
      events.push(sql);
      return { rows: sql.includes('FROM neon_auth.session') ? [{ id: sessionId }]
        : sql.startsWith('SELECT user_id') ? [{ user_id: 'another-account' }] : [] };
    }, release: () => events.push('release'),
  };
  const service = createNotificationService({ pool: { connect: async () => connection }, configuration: () => ({ available: true }) });
  await assert.rejects(service.subscribe(user.id, await subscription(), sessionId), (error) => error.status === 409 && error.code === 'SUBSCRIPTION_ACCOUNT_CHANGED');
  assert.equal(events.includes('ROLLBACK'), true);
  assert.equal(events.at(-1), 'release');
  assert.equal(events.some((sql) => sql.startsWith('INSERT') || sql.startsWith('DELETE')), false);
});

test('subscription session binding comes only from the signed server identity, never from the browser payload', async () => {
  const calls = [];
  const api = createNotificationHandlers({ getUser: async () => ({ ...user, sessionId }),
    service: { subscribe: async (...args) => { calls.push(args); return { ok: true }; } } }).subscriptions;
  const value = await subscription();
  assert.equal((await api.POST(request('subscriptions', 'POST', { ...value, sessionId: 'attacker-session' }))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await api.POST(request('subscriptions', 'POST', value))).status, 200);
  assert.equal(calls[0][0], user.id);
  assert.equal(calls[0][2], sessionId);
});

test('expired or foreign managed sessions cannot attach a device even with a matching account header', async () => {
  const events = [];
  const connection = { query: async (sql) => { events.push(sql); return { rows: [] }; }, release() {} };
  const service = createNotificationService({ pool: { connect: async () => connection }, configuration: () => ({ available: true }) });
  await assert.rejects(service.subscribe(user.id, await subscription(), sessionId), (error) => error.status === 401);
  assert.equal(events.some((sql) => sql.startsWith('INSERT')), false);
  assert.equal(events.includes('ROLLBACK'), true);
});

test('push-only worker displays a bounded notification and rejects external navigation without installing a fetch/offline handler', async () => {
  const listeners = new Map();
  const notifications = [];
  const opened = [];
  const self = {
    location: { origin: 'https://mycloset.test' },
    addEventListener: (event, handler) => listeners.set(event, handler),
    skipWaiting: async () => {},
    registration: { showNotification: async (...args) => notifications.push(args) },
    clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url) },
  };
  vm.runInNewContext(readFileSync(new URL('../public/mycloset-push.js', import.meta.url), 'utf8'), { self, URL });
  assert.equal(listeners.has('fetch'), false);
  let work;
  listeners.get('push')({ data: { json: () => ({ body: 'a'.repeat(1000), url: 'https://evil.invalid/private', tag: 'event' }) }, waitUntil: (promise) => { work = promise; } });
  await work;
  assert.equal(notifications[0][0], 'MyCloset');
  assert.equal(notifications[0][1].body.length, 300);
  assert.equal(notifications[0][1].data.url, '/notifications');
  listeners.get('notificationclick')({ notification: { data: notifications[0][1].data, close() {} }, waitUntil: (promise) => { work = promise; } });
  await work;
  assert.deepEqual(opened, ['https://mycloset.test/notifications']);
});

test('background status checks and logout never request browser permission, and an account change cancels an explicit enable', async () => {
  const names = ['window', 'navigator', 'localStorage', 'Notification', 'fetch'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const values = new Map([['mycloset:push-owner:v1', user.id]]);
  let asked = 0;
  let unsubscribed = 0;
  let subscribed = 0;
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', unsubscribe: async () => { unsubscribed++; } };
  const notifications = { permission: 'default', requestPermission: async () => { asked++; return 'granted'; } };
  const registration = { active: { scriptURL: 'https://mycloset.test/mycloset-push.js' },
    pushManager: { getSubscription: async () => subscription, subscribe: async () => { subscribed++; return subscription; } } };
  const mocks = {
    window: { isSecureContext: true, Notification: notifications, PushManager: function() {} },
    Notification: notifications,
    localStorage: { getItem: (key) => values.get(key), removeItem: (key) => values.delete(key) },
    navigator: { serviceWorker: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) } },
    fetch: async () => Response.json({ ok: true }),
  };
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: mocks[name] });
    assert.equal(await browserNotificationEnabled(user.id), true);
    assert.equal(asked, 0);
    await disconnectBrowserNotifications(user.id);
    assert.equal(unsubscribed, 1);
    assert.equal(asked, 0);
    let current = true;
    notifications.requestPermission = async () => { asked++; current = false; return 'granted'; };
    await assert.rejects(enableBrowserNotifications(user.id, 'public-key', { isCurrent: () => current }), (error) => error.name === 'AbortError');
    assert.equal(asked, 1);
    assert.equal(subscribed, 0);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
