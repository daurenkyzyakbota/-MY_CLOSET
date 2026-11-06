import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHandlers, validateAccountNamePatch } from '../lib/cloud/account-handlers.js';

const origin = 'https://closet.example';
const request = (body, headers = {}, method = 'PATCH') =>
  new Request(`${origin}/api/account/details`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-MyCloset-Account': 'user-a',
      ...headers,
    },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
function fixture(overrides = {}) {
  const calls = { auth: 0, reads: [], updates: [] };
  let record = {
    id: 'user-a', name: 'Старое имя', email: 'owner@provider.kz',
    role: 'user', privateCredential: 'hidden', emailVerified: false,
  };
  const api = createAccountHandlers({
    configured: () => true,
    getUser: async () => {
      calls.auth++;
      return { id: 'user-a', name: 'Signed cached name', emailVerified: false };
    },
    readUser: async (userId) => {
      calls.reads.push(userId);
      return record;
    },
    updateName: async (name) => {
      calls.updates.push(name);
      record = { ...record, name };
      return { data: { status: true }, error: null };
    },
    ...overrides,
  });
  return { api, calls };
}

test('account name edits accept trimmed Unicode names and reject malformed or elevated patches', () => {
  assert.deepEqual(validateAccountNamePatch({ name: '  Акбота 👗  ' }), { name: 'Акбота 👗' });
  for (const value of [
    null, [], {}, { name: null }, { name: '' }, { name: '   ' },
    { name: 'x'.repeat(81) }, { name: 'Line\nBreak' }, { name: 'Null\u0000Name' },
    { name: 'A', email: 'other@provider.kz' }, { name: 'A', role: 'admin' },
    { name: 'A', emailVerified: true },
  ])
    assert.throws(() => validateAccountNamePatch(value), (error) => error.status === 400);
});

test('private account details come from durable identity and expose only own id/name/email', async () => {
  const { api, calls } = fixture();
  const response = await api.GET(request(undefined, {}, 'GET'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: { id: 'user-a', name: 'Старое имя', email: 'owner@provider.kz' },
  });
  assert.deepEqual(calls.reads, ['user-a']);
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  assert.equal(response.headers.get('Vary'), 'Cookie');
});

test('name saves use the managed update operation and acknowledge the durable saved name', async () => {
  const { api, calls } = fixture();
  const response = await api.PATCH(request({ name: '  Новое имя 👗  ' }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.updates, ['Новое имя 👗']);
  assert.deepEqual(calls.reads, ['user-a']);
  assert.equal((await response.json()).user.name, 'Новое имя 👗');
});

test('foreign origins, revoked sessions and stale account headers cannot edit another account', async () => {
  const foreign = fixture();
  assert.equal((await foreign.api.PATCH(request({ name: 'New' }, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal(foreign.calls.auth, 0);
  for (const headers of [{ 'X-MyCloset-Account': '' }, { 'X-MyCloset-Account': 'user-b' }]) {
    const { api, calls } = fixture();
    assert.equal((await api.PATCH(request({ name: 'New' }, headers))).status, 409);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.reads.length, 0);
  }
  const revoked = fixture({ getUser: async () => null });
  assert.equal((await revoked.api.PATCH(request({ name: 'New' }))).status, 401);
  assert.equal((await revoked.api.GET(request(undefined, {}, 'GET'))).status, 401);
  assert.equal(revoked.calls.updates.length, 0);
  assert.equal(revoked.calls.reads.length, 0);
});

test('invalid JSON, content type, size and forbidden fields are rejected before managed writes', async () => {
  for (const [incoming, status] of [
    [request('{bad'), 400],
    [request({ name: 'New' }, { 'Content-Type': 'text/plain' }), 415],
    [request({ name: 'New' }, { 'Content-Length': '3000' }), 413],
    [request(' '.repeat(2049)), 413],
    [request({ name: 'New', email: 'other@provider.kz' }), 400],
    [request({ name: 'New', role: 'admin' }), 400],
  ]) {
    const { api, calls } = fixture();
    assert.equal((await api.PATCH(incoming)).status, status);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.reads.length, 0);
  }
});

test('managed errors, unconfirmed writes and mismatched database identities never report success', async () => {
  for (const [overrides, status, code] of [
    [{ updateName: async () => ({ error: { status: 429, message: 'Internal' } }) }, 429, 'TOO_MANY_REQUESTS'],
    [{ updateName: async () => ({ error: { status: 400, message: 'Internal' } }) }, 503, 'ACCOUNT_UPDATE_FAILED'],
    [{ updateName: async () => ({ data: { status: true } }) }, 503, 'ACCOUNT_UPDATE_UNCONFIRMED'],
    [{ readUser: async () => ({ id: 'other', name: 'New', email: 'other@provider.kz' }) }, 503, 'ACCOUNT_UNAVAILABLE'],
    [{ updateName: async () => { throw new Error('Secret connection details'); } }, 503, 'ACCOUNT_UNAVAILABLE'],
  ]) {
    const { api } = fixture(overrides);
    const response = await api.PATCH(request({ name: 'New' }));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /Internal|Secret|other@provider/);
  }
});
