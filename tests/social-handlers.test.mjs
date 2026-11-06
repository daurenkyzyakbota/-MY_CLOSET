import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialHandlers } from '../lib/social/handlers.js';

const request = (body, headers = {}) =>
  new Request('http://localhost:3007/api/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3007', ...headers },
    body: JSON.stringify(body),
  });
function fixture(user = { id: 'owner' }) {
  const calls = [];
  return {
    calls,
    ...createSocialHandlers({
      configured: () => true,
      getUser: async () => user,
      service: {
        execute: async (...args) => {
          calls.push(args);
          return { ok: true };
        },
      },
    }),
  };
}
test('social mutations reject a foreign origin before reading session or database', async () => {
  const api = fixture();
  const response = await api.POST(
    request({ action: 'profile.save', input: {} }, { Origin: 'http://evil.example' }),
  );
  assert.equal(response.status, 403);
  assert.equal(api.calls.length, 0);
});
test('social mutations require matching verified account even with a valid cookie', async () => {
  const api = fixture();
  for (const headers of [{}, { 'X-MyCloset-Account': 'someone-else' }]) {
    const response = await api.POST(
      request({ action: 'profile.save', input: { userId: 'owner' } }, headers),
    );
    assert.equal(response.status, 409);
  }
  assert.equal(api.calls.length, 0);
});
test('social mutation ownership comes only from the verified session', async () => {
  const api = fixture();
  const response = await api.POST(
    request({ action: 'profile.save', input: { name: 'Имя' } }, { 'X-MyCloset-Account': 'owner' }),
  );
  assert.equal(response.status, 200);
  assert.equal(api.calls[0][2].id, 'owner');
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  assert.equal(response.headers.get('Vary'), 'Cookie');
});
test('public reads without an account header use guest permissions even when cookies exist', async () => {
  const api = fixture();
  const response = await api.POST(
    request(
      { action: 'posts.list', input: { scope: 'public' } },
      { Cookie: 'session=old-account' },
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(api.calls[0][2], null);
});
test('native deletion and image extraction cannot be called through generic social RPC', async () => {
  const api = fixture();
  for (const action of ['account.delete', 'media.get'])
    assert.equal(
      (await api.POST(request({ action, input: {} }, { 'X-MyCloset-Account': 'owner' }))).status,
      400,
    );
  assert.equal(api.calls.length, 0);
});
test('social API rejects oversized bodies and unknown envelope fields', async () => {
  const api = fixture();
  const tooLarge = request(
    { action: 'profile.save', input: {} },
    { 'Content-Length': String(13 * 1024 * 1024) },
  );
  assert.equal((await api.POST(tooLarge)).status, 413);
  assert.equal(
    (await api.POST(request({ action: 'bootstrap', input: {}, user: { id: 'owner' } }))).status,
    400,
  );
});
test('unexpected database errors never expose internals or credentials', async () => {
  const api = createSocialHandlers({
    configured: () => true,
    getUser: async () => ({ id: 'owner' }),
    service: {
      execute: async () => {
        throw new Error('postgres://secret');
      },
    },
  });
  const response = await api.POST(
    request({ action: 'bootstrap', input: {} }, { 'X-MyCloset-Account': 'owner' }),
  );
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret'));
});
