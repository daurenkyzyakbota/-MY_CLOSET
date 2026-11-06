import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { emptyState, demoState } from '../lib/data/model.js';
import {
  canonicalSnapshotJson,
  hashSnapshot,
  planCloudSync,
  authErrorMessage,
  cloudRequiresHttps,
  CLOUD_OWNER_KEY,
  CLOUD_CONNECTION_PREFIX,
  readCloudConnection,
  writeCloudConnection,
  fetchCloudStatus,
  fetchCloudWardrobe,
  uploadCloudWardrobe,
  wardrobeSummary,
} from '../lib/cloud/cloud-sync-client.js';

const updatedAt = '2026-10-30T12:00:00.000Z';
const hash = (character) => character.repeat(64);
const base = { userId: 'user-a', connected: true, revision: 3, lastHash: hash('a') };
const cloud = (changes) => ({
  snapshot: emptyState(),
  revision: 3,
  hash: hash('a'),
  updatedAt,
  ...changes,
});
const response = (data, status = 200) => Response.json(data, { status });
function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('canonical hashes survive JSONB object-key reordering and preserve ordered lists', async () => {
  const state = demoState();
  state.profile.name = 'Бота 👗';
  const reordered = JSON.parse(JSON.stringify(state), (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .reverse()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
  const expected = createHash('sha256').update(canonicalSnapshotJson(state), 'utf8').digest('hex');
  assert.equal(await hashSnapshot(state), expected);
  assert.equal(await hashSnapshot(reordered), expected);
  reordered.items.reverse();
  assert.notEqual(await hashSnapshot(reordered), expected);
});

test('LAN HTTP fallback hashes exactly like Web Crypto without a secure context', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const state = emptyState();
  state.profile.name = 'Кызылорда 👗';
  const expected = await hashSnapshot(state);
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    assert.equal(await hashSnapshot(state), expected);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

test('sync planning never replaces simultaneous local and remote changes', () => {
  assert.equal(planCloudSync(null, cloud(), hash('a')), 'disconnected');
  assert.equal(planCloudSync(base, cloud(), hash('a')), 'acknowledge');
  assert.equal(planCloudSync(base, cloud(), hash('b')), 'upload');
  assert.equal(planCloudSync(base, cloud({ revision: 4, hash: hash('c') }), hash('a')), 'download');
  assert.equal(planCloudSync(base, cloud({ revision: 4, hash: hash('c') }), hash('b')), 'conflict');
  assert.equal(
    planCloudSync(base, cloud({ revision: 4, hash: hash('b') }), hash('b')),
    'acknowledge',
  );
  assert.equal(
    planCloudSync(base, cloud({ snapshot: null, revision: 0, hash: '' }), hash('a')),
    'conflict',
  );
  assert.equal(planCloudSync(base, cloud({ revision: 2 }), hash('b')), 'conflict');
});

test('metadata-only polls avoid photo downloads while still recognizing dirty local changes', () => {
  const unchanged = { notModified: true, revision: 3, hash: hash('a'), updatedAt };
  assert.equal(planCloudSync(base, unchanged, hash('a')), 'acknowledge');
  assert.equal(planCloudSync(base, unchanged, hash('b')), 'upload');
});

test('connection preferences contain only metadata and cannot bind another account to local data', () => {
  const storage = memoryStorage();
  assert.equal(writeCloudConnection(storage, base), true);
  assert.deepEqual(readCloudConnection(storage, 'user-a'), base);
  assert.equal(readCloudConnection(storage, 'user-b'), null);
  const saved = JSON.parse(storage.getItem(CLOUD_CONNECTION_PREFIX + 'user-a'));
  assert.deepEqual(Object.keys(saved).sort(), ['connected', 'lastHash', 'revision', 'userId']);
  writeCloudConnection(storage, { ...base, userId: 'user-b' });
  assert.equal(readCloudConnection(storage, 'user-a'), null);
  assert.equal(readCloudConnection(storage, 'user-b').userId, 'user-b');
  writeCloudConnection(storage, { ...base, userId: 'user-b', connected: false });
  assert.equal(storage.getItem(CLOUD_OWNER_KEY), null);
  assert.equal(readCloudConnection(storage, 'user-b'), null);
});

test('blocked or malformed browser preferences require consent again without crashing', () => {
  const blocked = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(readCloudConnection(blocked, 'user-a'), null);
  assert.equal(writeCloudConnection(blocked, base), false);
  for (const raw of [
    '{bad',
    '[]',
    'null',
    JSON.stringify({ ...base, revision: -1 }),
    JSON.stringify({ ...base, lastHash: 'bad' }),
    JSON.stringify({ ...base, userId: 'user-b' }),
  ]) {
    const storage = memoryStorage();
    storage.setItem(CLOUD_OWNER_KEY, 'user-a');
    storage.setItem(CLOUD_CONNECTION_PREFIX + 'user-a', raw);
    assert.equal(readCloudConnection(storage, 'user-a'), null);
  }
});

test('verified GET uses same-origin credentials and the account race guard, and validates the returned snapshot', async () => {
  const snapshot = demoState();
  const serverHash = await hashSnapshot(snapshot);
  const requests = [];
  const result = await fetchCloudWardrobe({
    userId: 'user-a',
    fetcher: async (path, options) => {
      requests.push({ path, options });
      return response({ snapshot, revision: 1, hash: serverHash, updatedAt });
    },
  });
  assert.deepEqual(result.snapshot, snapshot);
  assert.equal(requests[0].path, '/api/cloud/wardrobe');
  assert.equal(requests[0].options.headers['X-MyCloset-Account'], 'user-a');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.cache, 'no-store');
  await assert.rejects(
    fetchCloudWardrobe({
      userId: 'user-a',
      fetcher: async () => response({ snapshot, revision: 1, hash: hash('f'), updatedAt }),
    }),
    /целостность/,
  );
});

test('unchanged revision responses require the exact requested revision and do not include a snapshot', async () => {
  const result = await fetchCloudWardrobe({
    userId: 'user-a',
    knownRevision: 3,
    fetcher: async (path) => {
      assert.equal(path, '/api/cloud/wardrobe?revision=3');
      return response({ notModified: true, revision: 3, hash: hash('a'), updatedAt });
    },
  });
  assert.deepEqual(result, { notModified: true, revision: 3, hash: hash('a'), updatedAt });
  assert.equal(Object.hasOwn(result, 'snapshot'), false);
  await assert.rejects(
    fetchCloudWardrobe({
      knownRevision: 3,
      fetcher: async () => response({ notModified: true, revision: 4, hash: hash('a'), updatedAt }),
    }),
    /версию/,
  );
});

test('uploads carry only optimistic revision and validated wardrobe; response hash and revision must match', async () => {
  const snapshot = demoState();
  const before = structuredClone(snapshot);
  const serverHash = await hashSnapshot(snapshot);
  const result = await uploadCloudWardrobe(snapshot, 3, {
    userId: 'user-a',
    fetcher: async (path, options) => {
      assert.equal(path, '/api/cloud/wardrobe');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['revision', 'snapshot']);
      assert.equal(body.revision, 3);
      assert.deepEqual(body.snapshot, snapshot);
      assert.equal(options.headers['X-MyCloset-Account'], 'user-a');
      return response({ revision: 4, hash: serverHash, updatedAt });
    },
  });
  assert.equal(result.revision, 4);
  assert.deepEqual(snapshot, before);
  await assert.rejects(
    uploadCloudWardrobe(snapshot, 3, {
      fetcher: async () => response({ revision: 3, hash: serverHash, updatedAt }),
    }),
    /подтвердить/,
  );
});

test('authentication loss, account changes, CAS conflicts and network failures stay explicit', async () => {
  for (const [status, code, match] of [
    [401, '', /Войдите/],
    [409, 'ACCOUNT_CHANGED', /Аккаунт изменился/],
    [409, 'REVISION_CONFLICT', /уже есть изменения/],
    [413, '', /размер/],
  ]) {
    await assert.rejects(
      fetchCloudWardrobe({ fetcher: async () => response({ code }, status) }),
      (error) => error.status === status && error.code === code && match.test(error.message),
    );
  }
  await assert.rejects(
    fetchCloudWardrobe({
      fetcher: async () => {
        throw new TypeError('Failed to fetch');
      },
    }),
    /Изменения остаются/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchCloudWardrobe({
      signal: controller.signal,
      fetcher: async () => {
        throw new DOMException('Cancelled', 'AbortError');
      },
    }),
    { name: 'AbortError' },
  );
});

test('configuration and consent summaries describe every persisted collection without fake counts', async () => {
  assert.deepEqual(
    await fetchCloudStatus({ fetcher: async () => response({ configured: true }) }),
    { configured: true },
  );
  await assert.rejects(
    fetchCloudStatus({ fetcher: async () => response({ configured: 'yes' }) }),
    /доступность/,
  );
  assert.match(wardrobeSummary(null), /пока нет/);
  const state = emptyState();
  assert.equal(
    wardrobeSummary(state),
    'Вещей: 0, образов: 0, планов: 0, покупок: 0. Отметок носки: 0, капсул: 0, поездок: 0.',
  );
});

test('real Neon normalized auth codes and upstream Better Auth codes receive the same useful Russian errors', () => {
  assert.equal(authErrorMessage({ code: 'invalid_credentials' }), 'Неверная почта или пароль.');
  assert.equal(
    authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' }),
    'Неверная почта или пароль.',
  );
  assert.match(authErrorMessage({ code: 'email_exists' }), /уже существует/);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /Подтвердите почту/);
  assert.match(authErrorMessage({ code: 'over_request_rate_limit' }), /Слишком много/);
  assert.match(authErrorMessage({ code: 'INVALID_OTP' }), /Неверный код/);
});

test('LAN HTTP clearly requires HTTPS while localhost development and genuine HTTPS remain enabled', () => {
  assert.equal(cloudRequiresHttps(new URL('http://192.168.10.3:3007/account'), false), true);
  assert.equal(cloudRequiresHttps(new URL('http://wardrobe.local/account'), false), true);
  for (const url of [
    'http://localhost:3007/account',
    'http://127.0.0.1:3007/account',
    'http://[::1]:3007/account',
    'http://dev.localhost:3007/account',
  ])
    assert.equal(cloudRequiresHttps(new URL(url), false), false);
  assert.equal(cloudRequiresHttps(new URL('https://mycloset.example/account'), true), false);
  assert.equal(cloudRequiresHttps(new URL('http://192.168.10.3:3007/account'), true), false);
});
