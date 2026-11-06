import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandlers } from '../lib/cloud/cloud-handlers.js';
import { emptyState, MAX_BACKUP_FILE_BYTES } from '../lib/data/model.js';

function fixture(user = { id: 'account-a' }) {
  const entries = new Map();
  const calls = [];
  const storage = {
    async read(id, revision) {
      calls.push(['read', id]);
      const value = entries.get(id);
      return !value
        ? { snapshot: null, revision: 0, hash: '', updatedAt: null }
        : revision === value.revision
          ? {
              notModified: true,
              revision: value.revision,
              hash: value.hash,
              updatedAt: value.updatedAt,
            }
          : structuredClone(value);
    },
    async write(id, revision, snapshot, hash) {
      calls.push(['write', id]);
      const current = entries.get(id);
      if ((current?.revision || 0) !== revision) return null;
      const value = {
        snapshot,
        hash,
        revision: revision + 1,
        updatedAt: '2026-10-30T00:00:00.000Z',
      };
      entries.set(id, value);
      return { revision: value.revision, hash, updatedAt: value.updatedAt };
    },
  };
  return { entries, calls, api: createCloudHandlers({ getUser: async () => user, storage }) };
}
const request = (method = 'GET', body, extra = {}) =>
  new Request('http://localhost:3007/api/cloud/wardrobe', {
    method,
    headers: {
      'X-MyCloset-Account': 'account-a',
      Origin: 'http://localhost:3007',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });

test('cloud endpoints require a real session before reading or writing user data', async () => {
  const { api, calls } = fixture(null);
  assert.equal((await api.GET(request())).status, 401);
  assert.equal(
    (await api.POST(request('POST', { revision: 0, snapshot: emptyState() }))).status,
    401,
  );
  assert.deepEqual(calls, []);
});
test('a cookie account change rejects the stale browser account rather than uploading across users', async () => {
  const { api, calls } = fixture({ id: 'account-b' });
  const response = await api.POST(request('POST', { revision: 0, snapshot: emptyState() }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ACCOUNT_CHANGED');
  assert.deepEqual(calls, []);
});
test('cross-site and missing-origin writes are blocked before storage', async () => {
  const { api, calls } = fixture();
  for (const Origin of ['https://foreign.example', 'null', ''])
    assert.equal(
      (await api.POST(request('POST', { revision: 0, snapshot: emptyState() }, { Origin }))).status,
      403,
    );
  assert.deepEqual(calls, []);
});
test('strict envelopes, JSON, revisions and validated snapshots reject unsafe writes', async () => {
  const { api, calls } = fixture();
  for (const body of [
    { revision: -1, snapshot: emptyState() },
    { revision: '0', snapshot: emptyState() },
    { revision: 0, snapshot: emptyState(), user_id: 'account-b' },
  ])
    assert.equal((await api.POST(request('POST', body))).status, 400);
  assert.equal((await api.POST(request('POST', '{bad'))).status, 400);
  assert.equal(
    (await api.POST(request('POST', { revision: 0, snapshot: { version: 99 } }))).status,
    422,
  );
  assert.equal(
    (await api.POST(request('POST', 'text', { 'Content-Type': 'text/plain' }))).status,
    415,
  );
  assert.deepEqual(calls, []);
});
test('oversized payloads are rejected from declared length before parsing data', async () => {
  const { api, calls } = fixture();
  assert.equal(
    (
      await api.POST(
        request('POST', '{}', { 'Content-Length': String(MAX_BACKUP_FILE_BYTES + 4097) }),
      )
    ).status,
    413,
  );
  assert.deepEqual(calls, []);
});
test('optimistic revisions keep one winner and reject stale writes without losing the cloud version', async () => {
  const { api, entries } = fixture();
  const a = emptyState();
  a.profile.name = 'Первая версия';
  const first = await api.POST(request('POST', { revision: 0, snapshot: a }));
  assert.equal(first.status, 200);
  const written = await first.json();
  assert.equal(written.revision, 1);
  assert.match(written.hash, /^[a-f0-9]{64}$/);
  const b = emptyState();
  b.profile.name = 'Конкурент';
  assert.equal((await api.POST(request('POST', { revision: 0, snapshot: b }))).status, 409);
  assert.equal(entries.get('account-a').snapshot.profile.name, 'Первая версия');
  assert.equal((await api.POST(request('POST', { revision: 1, snapshot: b }))).status, 200);
  assert.equal(entries.get('account-a').revision, 2);
});
test('private reads are canonical and conditional reads omit photos and the entire snapshot', async () => {
  const { api } = fixture();
  const state = emptyState();
  await api.POST(request('POST', { revision: 0, snapshot: state }));
  const read = await api.GET(request());
  assert.match(read.headers.get('Cache-Control'), /private.*no-store/);
  assert.equal(read.headers.get('Vary'), 'Cookie');
  const full = await read.json();
  assert.deepEqual(full.snapshot, state);
  const conditional = new Request('http://localhost:3007/api/cloud/wardrobe?revision=1', {
    headers: { 'X-MyCloset-Account': 'account-a' },
  });
  const small = await (await api.GET(conditional)).json();
  assert.equal(small.notModified, true);
  assert.equal(Object.hasOwn(small, 'snapshot'), false);
  assert.equal(small.hash, full.hash);
  assert.equal(
    (
      await api.GET(
        new Request('http://localhost:3007/api/cloud/wardrobe?revision=1&revision=2', {
          headers: { 'X-MyCloset-Account': 'account-a' },
        }),
      )
    ).status,
    400,
  );
});
test('a proxied HTTPS origin is checked against its public host and server failures do not disclose credentials', async () => {
  const { api } = fixture();
  const proxied = new Request('http://0.0.0.0:3007/api/cloud/wardrobe', {
    method: 'POST',
    headers: {
      host: 'closet.example.com',
      'x-forwarded-proto': 'https',
      origin: 'https://closet.example.com',
      'x-mycloset-account': 'account-a',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ revision: 0, snapshot: emptyState() }),
  });
  assert.equal((await api.POST(proxied)).status, 200);
  const broken = createCloudHandlers({
    getUser: async () => ({ id: 'account-a' }),
    storage: {
      read: async () => {
        throw Error('postgresql://private-password');
      },
    },
  });
  const response = await broken.GET(request());
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes('private-password'), false);
});
