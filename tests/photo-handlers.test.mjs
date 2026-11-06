import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoHandlers } from '../lib/cloud/photo-handlers.js';
import { createCloudHandlers } from '../lib/cloud/cloud-handlers.js';
import { emptyState } from '../lib/data/model.js';
import { putItem } from '../lib/data/closet-state.js';
import { photoDigest, externalizeSnapshotPhotos, MAX_PHOTO_CHARACTERS, PHOTO_STORAGE_QUOTA } from '../lib/cloud/photo-transport.js';
import { hashSnapshot } from '../lib/cloud/cloud-sync-client.js';

const origin = 'https://closet.example';
const photo = 'data:image/png;base64,AAECAw==';
const photoId = await photoDigest(photo);
const otherId = await photoDigest('data:image/jpeg;base64,YWJjZA==');
const request = (method = 'GET', body, headers = {}, query = '') => new Request(`${origin}/api/cloud/photos${query}`, {
  method,
  headers: {
    'X-MyCloset-Account': 'account-a', Origin: origin,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
  },
  ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});

function fixture({ user = { id: 'account-a' }, configured = () => true, storage: overrides = {} } = {}) {
  const calls = [];
  const reports = [];
  const objects = new Map([
    ['account-a', new Map([[photoId, photo]])],
    ['account-b', new Map([[otherId, 'data:image/jpeg;base64,YWJjZA==']])],
  ]);
  const storage = {
    async describe(owner, ids) {
      calls.push(['describe', owner, ids]);
      return ids.filter((id) => objects.get(owner)?.has(id)).map((id) => ({ id, characters: objects.get(owner).get(id).length }));
    },
    async get(owner, id, options) {
      calls.push(['get', owner, id, options.signal]);
      return objects.get(owner)?.get(id) || null;
    },
    async put(owner, value, options) {
      calls.push(['put', owner, options.signal]);
      const id = await photoDigest(value);
      return { id, bytes: value.length };
    },
    async stats(owner) {
      calls.push(['stats', owner]);
      const records = objects.get(owner) || new Map();
      return { count: records.size, bytes: [...records.values()].reduce((sum, value) => sum + value.length, 0), limit: PHOTO_STORAGE_QUOTA };
    },
    ...overrides,
  };
  return {
    calls, reports, storage,
    api: createPhotoHandlers({ getUser: async () => user, configured, storage, report: (code) => reports.push(code) }),
  };
}

test('photo routes require a verified session and matching account before touching storage', async () => {
  for (const [user, headers, expected] of [
    [null, {}, 401], [{ id: 'account-b' }, {}, 409], [{ id: 'account-a' }, { 'X-MyCloset-Account': '' }, 409],
  ]) {
    const { api, calls } = fixture({ user });
    const response = await api.POST(request('POST', { photo }, headers));
    assert.equal(response.status, expected);
    assert.deepEqual(calls, []);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.equal(response.headers.get('vary'), 'Cookie');
  }
  const unavailable = fixture({ configured: () => false });
  assert.equal((await unavailable.api.GET(request('GET', undefined, {}, '?stats=1'))).status, 503);
  assert.deepEqual(unavailable.calls, []);
});

test('foreign and missing origins cannot check or upload photos, regardless of a valid account cookie', async () => {
  for (const Origin of ['https://other.example', 'null', '']) {
    const { api, calls } = fixture();
    const response = await api.POST(request('POST', { photo }, { Origin }));
    assert.equal(response.status, 403);
    assert.deepEqual(calls, []);
  }
});

test('bounded JSON parsing rejects declared and streamed excess, malformed envelopes, unexpected keys and unsafe photo data', async () => {
  const limit = MAX_PHOTO_CHARACTERS + 4096;
  const cases = [
    [request('POST', { photo }, { 'Content-Type': 'text/plain' }), 415],
    [request('POST', { photo }, { 'Content-Length': String(limit + 1) }), 413],
    [request('POST', { photo }, { 'Content-Length': '-1' }), 413],
    [request('POST', ' '.repeat(limit + 1)), 413],
    [request('POST', '{invalid'), 400],
    [request('POST', null), 400],
    [request('POST', []), 400],
    [request('POST', { photo, userId: 'account-b' }), 400],
    [request('POST', { photo: 'data:image/svg+xml;base64,AAAA' }), 422],
    [request('POST', { photo: 'https://foreign.invalid/photo.png' }), 422],
    [request('POST', { photo: '' }), 422],
    [request('POST', { operation: 'check', ids: Array.from({ length: 101 }, () => photoId) }), 400],
    [request('POST', { operation: 'check', ids: [photoId.toUpperCase()] }), 400],
    [request('POST', { operation: 'check', ids: [photoId], owner: 'account-b' }), 400],
  ];
  for (const [input, status] of cases) {
    const { api, calls } = fixture();
    assert.equal((await api.POST(input)).status, status);
    assert.deepEqual(calls, []);
  }
});

test('photo metadata checks deduplicate owned IDs and never reveal another account object or any photo bytes', async () => {
  const { api, calls } = fixture();
  const response = await api.POST(request('POST', { operation: 'check', ids: [photoId, otherId, photoId] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { present: [photoId] });
  assert.deepEqual(calls[0], ['describe', 'account-a', [photoId, otherId]]);
  const denied = await api.GET(request('GET', undefined, {}, `?id=${otherId}`));
  assert.equal(denied.status, 404);
  assert.doesNotMatch(JSON.stringify(await denied.json()), /data:image|YWJjZA/);
});

test('GET accepts only one explicit photo ID or stats switch and reports bounded per-account metadata', async () => {
  for (const query of ['', '?id=bad', `?id=${photoId}&id=${photoId}`, '?stats=0', '?stats=1&stats=1', `?stats=1&id=${photoId}`, '?stats=1&owner=account-b']) {
    const { api, calls } = fixture();
    assert.equal((await api.GET(request('GET', undefined, {}, query))).status, 400);
    assert.deepEqual(calls, []);
  }
  const { api, calls } = fixture();
  const stats = await api.GET(request('GET', undefined, {}, '?stats=1'));
  assert.deepEqual(await stats.json(), { count: 1, bytes: photo.length, limit: PHOTO_STORAGE_QUOTA });
  assert.deepEqual(calls, [['stats', 'account-a']]);
  const found = await api.GET(request('GET', undefined, {}, `?id=${photoId}`));
  assert.deepEqual(await found.json(), { photo });
  assert.match(found.headers.get('cache-control'), /private.*no-store/);
});

test('uploads derive the owner from the verified session, return metadata only and carry request cancellation to storage', async () => {
  const { api, calls } = fixture();
  const input = request('POST', { photo });
  const response = await api.POST(input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: photoId, bytes: photo.length });
  assert.equal(calls[0][0], 'put');
  assert.equal(calls[0][1], 'account-a');
  assert.equal(calls[0][2], input.signal);
  const getInput = request('GET', undefined, {}, `?id=${photoId}`);
  await api.GET(getInput);
  assert.equal(calls[1][3], getInput.signal);
});

test('quota and infrastructure errors expose only safe public messages with private response headers', async () => {
  const quota = fixture({ storage: {
    put: async () => { throw Object.assign(new Error('private bucket credentials'), { code: 'PHOTO_QUOTA_EXCEEDED' }); },
  } });
  const quotaResponse = await quota.api.POST(request('POST', { photo }));
  assert.equal(quotaResponse.status, 413);
  assert.equal((await quotaResponse.json()).code, 'PHOTO_QUOTA_EXCEEDED');
  for (const operation of ['put', 'get', 'describe', 'stats']) {
    const { api, reports } = fixture({ storage: {
      [operation]: async () => { throw Object.assign(new Error('private DB password and SQL'), { code: 'TEST_STORAGE_FAILURE' }); },
    } });
    const input = operation === 'put' ? request('POST', { photo })
      : operation === 'describe' ? request('POST', { operation: 'check', ids: [photoId] })
        : request('GET', undefined, {}, operation === 'stats' ? '?stats=1' : `?id=${photoId}`);
    const response = await api[input.method](input);
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private|password|SQL|TEST_STORAGE_FAILURE/);
  assert.deepEqual(reports, ['request:TEST_STORAGE_FAILURE']);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
});

function wardrobeRequest(body) {
  return new Request(`${origin}/api/cloud/wardrobe`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-MyCloset-Account': 'account-a' },
    body: JSON.stringify(body),
  });
}

test('cloud metadata writes verify photo ownership and keep external references separate from the committed full-content hash', async () => {
  const local = emptyState();
  putItem(local, { id: 'item', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'], photo });
  const wire = await externalizeSnapshotPhotos(local, { findExisting: async () => [photoId], upload: async () => assert.fail('Already present') });
  const contentHash = await hashSnapshot(local);
  let written;
  const queries = [];
  const api = createCloudHandlers({
    getUser: async () => ({ id: 'account-a' }),
    photos: { describe: async (owner, ids) => { queries.push([owner, ids]); return [{ id: photoId, characters: photo.length }]; } },
    storage: { write: async (...args) => { written = args; return { revision: 1, hash: contentHash, updatedAt: '2026-11-06T10:00:00.000Z' }; } },
  });
  const response = await api.POST(wardrobeRequest({ revision: 0, snapshot: wire, contentHash }));
  assert.equal(response.status, 200);
  assert.deepEqual(queries, [['account-a', [photoId]]]);
  assert.equal(written[0], 'account-a');
  assert.deepEqual(written[2], wire);
  assert.equal(written[3], contentHash);
  assert.equal(written[4].wireHash, await hashSnapshot(wire));

  const foreign = createCloudHandlers({
    getUser: async () => ({ id: 'account-a' }), photos: { describe: async () => [] },
    storage: { write: async () => assert.fail('Foreign photo cannot be committed') },
  });
  const denied = await foreign.POST(wardrobeRequest({ revision: 0, snapshot: wire, contentHash }));
  assert.equal(denied.status, 422);
  assert.equal((await denied.json()).code, 'INVALID_SNAPSHOT');
});

test('a photo metadata database failure is an infrastructure error and never becomes a raw validation message', async () => {
  const local = emptyState();
  putItem(local, { id: 'item', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'], photo });
  const wire = await externalizeSnapshotPhotos(local, { findExisting: async () => [photoId], upload: async () => {} });
  const reports = [];
  const api = createCloudHandlers({
    getUser: async () => ({ id: 'account-a' }),
    photos: { describe: async () => { throw Object.assign(new Error('private database URL password SQL'), { code: 'TEST_DB_FAILURE' }); } },
    storage: { write: async () => assert.fail('No write after metadata failure') },
    report: (code) => reports.push(code),
  });
  const response = await api.POST(wardrobeRequest({ revision: 0, snapshot: wire, contentHash: await hashSnapshot(local) }));
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private|password|SQL|TEST_DB_FAILURE/);
  assert.deepEqual(reports, ['TEST_DB_FAILURE']);
});

test('cloud reads verify wire bytes but retain the full hydrated content hash for external photos', async () => {
  const local = emptyState();
  putItem(local, { id: 'item', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'], photo });
  const wire = await externalizeSnapshotPhotos(local, { findExisting: async () => [photoId], upload: async () => {} });
  const contentHash = await hashSnapshot(local);
  const wireHash = await hashSnapshot(wire);
  for (const corrupt of [false, true]) {
    const owners = [];
    const api = createCloudHandlers({
      getUser: async () => ({ id: 'account-a' }),
      photos: { describe: async (owner) => { owners.push(owner); return [{ id: photoId, characters: photo.length }]; } },
      storage: { read: async (owner) => {
        assert.equal(owner, 'account-a');
        return { snapshot: wire, hash: contentHash, wireHash: corrupt ? 'f'.repeat(64) : wireHash, revision: 2, updatedAt: '2026-11-06T10:00:00.000Z' };
      } },
    });
    const response = await api.GET(new Request(`${origin}/api/cloud/wardrobe`, {
      headers: { 'X-MyCloset-Account': 'account-a' },
    }));
    assert.equal(response.status, corrupt ? 502 : 200);
    assert.deepEqual(owners, ['account-a']);
    if (!corrupt) {
      const body = await response.json();
      assert.equal(body.hash, contentHash);
      assert.notEqual(body.hash, wireHash);
      assert.deepEqual(body.snapshot, wire);
    }
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
});

test('external-photo metadata requires a full-content commitment and inline snapshots reject a wrong commitment', async () => {
  const local = emptyState();
  putItem(local, { id: 'item', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'], photo });
  const wire = await externalizeSnapshotPhotos(local, { findExisting: async () => [photoId], upload: async () => {} });
  const api = createCloudHandlers({
    getUser: async () => ({ id: 'account-a' }),
    photos: { describe: async () => [{ id: photoId, characters: photo.length }] },
    storage: { write: async () => assert.fail('No commit with a missing or invalid commitment') },
  });
  assert.equal((await api.POST(wardrobeRequest({ revision: 0, snapshot: wire }))).status, 400);
  assert.equal((await api.POST(wardrobeRequest({ revision: 0, snapshot: local, contentHash: 'f'.repeat(64) }))).status, 422);
});
