import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudBaseKey, createCloudBaseStorage } from '../lib/cloud/cloud-merge-base.js';

function indexedDatabase() {
  let records = new Map();
  let fail = false;
  const api = {
    open(name, version) {
      assert.equal(name, 'mycloset-local-v1'); assert.equal(version, 1);
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(store, mode) {
            assert.equal(store, 'data');
            const changes = new Map(records);
            const tx = { objectStore: () => ({
              get(key) {
                const read = {};
                queueMicrotask(() => {
                  read.result = structuredClone(changes.get(key)); read.onsuccess?.();
                  if (fail && mode === 'readwrite') { fail = false; tx.error = new DOMException('Full', 'QuotaExceededError'); tx.onabort?.(); }
                  else { if (mode === 'readwrite') records = changes; tx.oncomplete?.(); }
                });
                return read;
              },
              put(value, key) { changes.set(key, structuredClone(value)); },
            }) };
            return tx;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { indexedDB: api, records: () => records, fail: () => { fail = true; } };
}
const base = (userId, revision = 1) => ({ userId, revision, hash: 'a'.repeat(64), snapshot: { version: 5, items: [{ id: 'dress', photo: 'data:image/png;base64,FULL' }] } });

test('merge bases keep full snapshots per account under independent IndexedDB keys', async () => {
  const db = indexedDatabase();
  const store = createCloudBaseStorage({ indexedDB: db.indexedDB });
  await store.write(base('alice'));
  await store.write(base('bob', 3));
  assert.deepEqual(await store.read('alice'), base('alice'));
  assert.equal((await store.read('bob')).revision, 3);
  assert.deepEqual([...db.records().keys()].sort(), ['cloud-base:alice', 'cloud-base:bob']);
  assert.equal(db.records().has('state'), false);
  assert.equal(db.records().has('account:alice'), false);
});
test('a delayed older acknowledgement cannot overwrite a newer stored base', async () => {
  const db = indexedDatabase();
  const store = createCloudBaseStorage({ indexedDB: db.indexedDB });
  await store.write(base('alice', 5));
  await store.write(base('alice', 3));
  assert.equal((await store.read('alice')).revision, 5);
});
test('storage failure does not report durable acknowledgement or destroy the previous base', async () => {
  const db = indexedDatabase();
  const store = createCloudBaseStorage({ indexedDB: db.indexedDB });
  await store.write(base('alice'));
  db.fail();
  await assert.rejects(store.write(base('alice', 2)), /Full/);
  assert.equal((await store.read('alice')).revision, 1);
  await assert.rejects(createCloudBaseStorage({ indexedDB: null }).read('alice'), /до закрытия/);
});
test('invalid accounts and malformed base records cannot address wardrobe storage', async () => {
  assert.throws(() => cloudBaseKey('account:alice'), /Некорректный/);
  assert.throws(() => cloudBaseKey(''), /Некорректный/);
  const store = createCloudBaseStorage({ indexedDB: null });
  await assert.rejects(store.write({ ...base('alice'), revision: 0 }), /Некорректная/);
  await assert.rejects(store.write({ ...base('alice'), hash: 'no' }), /Некорректная/);
});
