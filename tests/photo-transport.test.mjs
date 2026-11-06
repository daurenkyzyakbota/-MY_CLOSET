import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState } from '../lib/data/model.js';
import { putItem } from '../lib/data/closet-state.js';
import { moveItemsToTrash } from '../lib/data/trash.js';
import {
  externalizeSnapshotPhotos,
  hydrateSnapshotPhotos,
  validatePhotoSnapshot,
  validateStoredPhoto,
  photoDigest,
  photoSlots,
  PHOTO_REFERENCE_PREFIX,
  MAX_PHOTO_CHARACTERS,
} from '../lib/cloud/photo-transport.js';
import {
  canonicalSnapshotJson,
  hashSnapshot,
  uploadCloudWardrobe,
  fetchCloudWardrobe,
} from '../lib/cloud/cloud-sync-client.js';

const photoA = 'data:image/png;base64,AAECAw==';
const photoB = 'data:image/jpeg;base64,YWJjZA==';
const updatedAt = '2026-11-06T10:00:00.000Z';
function snapshot() {
  const state = emptyState();
  for (const [id, photo] of [['one', photoA], ['same-photo', photoA], ['two', photoB], ['deleted', photoA]])
    putItem(state, { id, name: id, category: 'top', colors: ['white'], seasons: ['summer'], photo });
  moveItemsToTrash(state, ['deleted']);
  return validateState(state);
}

async function externalized(original = snapshot()) {
  const objects = new Map();
  const wire = await externalizeSnapshotPhotos(original, {
    findExisting: async () => [],
    upload: async (id, photo) => objects.set(id, photo),
  });
  return { wire, objects, original };
}

test('external photo transport round trips the exact original URI in active and trashed garments without mutating backups', async () => {
  const original = snapshot();
  const before = structuredClone(original);
  const { wire, objects } = await externalized(original);
  assert.equal(objects.size, 2);
  assert.equal(photoSlots(wire).length, 4);
  assert.ok(photoSlots(wire).every(({ record }) => record.photo.startsWith(PHOTO_REFERENCE_PREFIX)));
  assert.deepEqual(original, before);
  assert.doesNotThrow(() => validateState(original));
  assert.throws(() => validateState(wire));
  const downloads = [];
  const hydrated = await hydrateSnapshotPhotos(wire, {
    download: async (id) => { downloads.push(id); return objects.get(id); },
  });
  assert.deepEqual(hydrated, before);
  assert.equal(downloads.length, 2);
  assert.equal(hydrated.trash[0].record.photo, photoA);
  assert.deepEqual(original, before);
});

test('existing objects are reused and cancellation after metadata discovery prevents any upload', async () => {
  const state = snapshot();
  const existing = await photoDigest(photoA);
  const uploads = [];
  await externalizeSnapshotPhotos(state, {
    findExisting: async () => [existing],
    upload: async (id) => uploads.push(id),
  });
  assert.deepEqual(uploads, [await photoDigest(photoB)]);
  const abort = new AbortController();
  await assert.rejects(externalizeSnapshotPhotos(state, {
    assertCurrent: () => abort.signal.throwIfAborted(),
    findExisting: async () => { abort.abort(); return []; },
    upload: async () => assert.fail('No upload after account change/abort'),
  }), { name: 'AbortError' });
  assert.equal(state.items[0].photo, photoA);
});

test('hydration detects corrupted or missing objects before exposing a partially hydrated copy', async () => {
  const { wire } = await externalized();
  const before = structuredClone(wire);
  for (const download of [async () => photoB, async () => undefined, async () => 'https://other.invalid/private.png']) {
    await assert.rejects(hydrateSnapshotPhotos(wire, { download }));
    assert.deepEqual(wire, before);
  }
});

test('hydration bounds parallel downloads and checks cancellation before returning any local state', async () => {
  const state = emptyState();
  for (let index = 0; index < 7; index++)
    putItem(state, {
      id: `item-${index}`, name: `Вещь ${index}`, category: 'top', colors: ['white'], seasons: ['summer'],
      photo: 'data:image/png;base64,' + Buffer.from(String(index)).toString('base64'),
    });
  const { wire, objects } = await externalized(state);
  let active = 0;
  let maximum = 0;
  await hydrateSnapshotPhotos(wire, {
    download: async (id) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return objects.get(id);
    },
  });
  assert.equal(maximum, 3);
  const abort = new AbortController();
  await assert.rejects(hydrateSnapshotPhotos(wire, {
    assertCurrent: () => abort.signal.throwIfAborted(),
    download: async (id) => { abort.abort(); return objects.get(id); },
  }), { name: 'AbortError' });
  assert.ok(wire.items.every((record) => record.photo.startsWith(PHOTO_REFERENCE_PREFIX)));
});

test('photo validation enforces raster/data URI and exact per-photo size boundaries', () => {
  const prefix = 'data:image/png;base64,';
  const largest = prefix + 'A'.repeat(MAX_PHOTO_CHARACTERS - prefix.length);
  assert.equal(validateStoredPhoto(largest).length, MAX_PHOTO_CHARACTERS);
  for (const invalid of ['', undefined, null, largest + 'A', 'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'https://host.invalid/photo.png', photoA + '\n'])
    assert.throws(() => validateStoredPhoto(invalid));
});

test('wire validation requires every photo to belong to the verified account and counts repeated active/trash slots toward 50M', async () => {
  const { wire, objects } = await externalized();
  const described = [];
  const checked = await validatePhotoSnapshot(wire, async (ids) => {
    described.push(...ids);
    return ids.map((id) => ({ id, characters: objects.get(id).length }));
  });
  assert.equal(checked.hasReferences, true);
  assert.equal(described.length, 2);
  assert.deepEqual(checked.snapshot, wire);
  await assert.rejects(validatePhotoSnapshot(wire, async () => []), /этом аккаунте/);
  await assert.rejects(validatePhotoSnapshot(wire, async (ids) => ids.map((id) => ({ id, characters: MAX_PHOTO_CHARACTERS + 1 }))), /этом аккаунте/);
  const many = emptyState();
  const id = await photoDigest(photoA);
  for (let index = 0; index < 13; index++)
    putItem(many, { id: `item-${index}`, name: 'Вещь', category: 'top', colors: ['white'], seasons: ['summer'], photo: PHOTO_REFERENCE_PREFIX + id });
  await assert.rejects(validatePhotoSnapshot(many, async () => [{ id, characters: MAX_PHOTO_CHARACTERS }]), /50 МБ/);
});

test('legacy v5 empty-trash compatibility keeps canonical content hashes and exact full URI content', async () => {
  const withTrash = snapshot();
  withTrash.trash = [];
  const legacy = structuredClone(withTrash);
  delete legacy.trash;
  assert.equal(canonicalSnapshotJson(withTrash), canonicalSnapshotJson(legacy));
  assert.equal(await hashSnapshot(withTrash), await hashSnapshot(legacy));
  assert.equal(await hashSnapshot(validateState(legacy)), await hashSnapshot(legacy));
  const differentURI = structuredClone(withTrash);
  differentURI.items[0].photo = photoB;
  assert.notEqual(await hashSnapshot(withTrash), await hashSnapshot(differentURI));
});

test('cloud client uploads deduplicated objects before metadata and downloads an independently verified self-contained snapshot', async () => {
  const original = snapshot();
  const before = structuredClone(original);
  const objects = new Map();
  const calls = [];
  let remote;
  const fetcher = async (url, options) => {
    assert.equal(options.headers['X-MyCloset-Account'], 'account-a');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    calls.push([url, options.method]);
    if (url === '/api/cloud/photos' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.operation === 'check') return Response.json({ present: body.ids.filter((id) => objects.has(id)) });
      const id = await photoDigest(body.photo);
      objects.set(id, body.photo);
      return Response.json({ id, bytes: body.photo.length });
    }
    if (url === '/api/cloud/wardrobe' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.revision, 0);
      assert.equal(body.contentHash, await hashSnapshot(original));
      assert.ok(!JSON.stringify(body.snapshot).includes('data:image/'));
      remote = { snapshot: body.snapshot, revision: 1, hash: body.contentHash, updatedAt };
      return Response.json({ revision: 1, hash: body.contentHash, updatedAt });
    }
    if (url === '/api/cloud/wardrobe') return Response.json(remote);
    if (url.startsWith('/api/cloud/photos?id=')) return Response.json({ photo: objects.get(url.split('=')[1]) });
    throw new Error('Unexpected test route');
  };
  const uploaded = await uploadCloudWardrobe(original, 0, { userId: 'account-a', separatePhotos: true, fetcher });
  assert.deepEqual(uploaded.snapshot, original);
  assert.equal(objects.size, 2);
  assert.equal(calls.filter(([url]) => url === '/api/cloud/photos').length, 3);
  const fetched = await fetchCloudWardrobe({ userId: 'account-a', fetcher });
  assert.deepEqual(fetched.snapshot, before);
  assert.deepEqual(original, before);
});

test('cloud metadata is never committed after quota errors, upload digest mismatch, foreign presence IDs or cancellation', async () => {
  const original = snapshot();
  for (const failure of ['quota', 'digest', 'foreign-id', 'abort']) {
    const abort = new AbortController();
    let wardrobeWrites = 0;
    await assert.rejects(uploadCloudWardrobe(original, 0, {
      userId: 'account-a', separatePhotos: true, signal: abort.signal,
      fetcher: async (url, options) => {
        if (url === '/api/cloud/wardrobe') { wardrobeWrites++; return Response.json({}); }
        const body = JSON.parse(options.body);
        if (body.operation === 'check') {
          if (failure === 'abort') abort.abort();
          return Response.json({ present: failure === 'foreign-id' ? ['f'.repeat(64)] : [] });
        }
        if (failure === 'quota') return Response.json({ code: 'PHOTO_QUOTA_EXCEEDED', error: 'Private quota detail' }, { status: 413 });
        return Response.json({ id: 'f'.repeat(64) });
      },
    }));
    assert.equal(wardrobeWrites, 0);
    assert.equal(original.items[0].photo, photoA);
  }
});

test('the client rejects a hydrated copy whose full-content commitment differs even when each photo digest is valid', async () => {
  const { wire, objects } = await externalized();
  await assert.rejects(fetchCloudWardrobe({
    userId: 'account-a',
    fetcher: async (url) => url.startsWith('/api/cloud/photos')
      ? Response.json({ photo: objects.get(url.split('=')[1]) })
      : Response.json({ snapshot: wire, revision: 1, hash: 'f'.repeat(64), updatedAt }),
  }), /целостность облачной копии/);
});
