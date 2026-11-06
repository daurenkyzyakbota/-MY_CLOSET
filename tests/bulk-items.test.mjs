import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ITEMS, emptyState } from '../lib/data/model.js';
import { addItemBatch, prepareBatchPhotos, MAX_BATCH_PHOTOS } from '../lib/data/bulk-items.js';
import { createClosetController, itemFromDraft } from '../lib/data/closet-state.js';

const photo = 'data:image/png;base64,iVBORw0KGgo=';
const files = [{ name: 'Рубашка.jpg' }, { name: 'Брюки.png' }, { name: 'Кеды.webp' }];
const defaults = { category: 'top', colors: ['white'], seasons: ['summer'] };
const draft = (id) => itemFromDraft({ ...defaults, id, name: id, photo });

test('photo preparation is serial, preserves per-file names and uses independent metadata arrays', async () => {
  let active = 0;
  let maximum = 0;
  const progress = [];
  const rows = await prepareBatchPhotos(files, {
    defaults,
    compress: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return photo;
    },
    onProgress: ({ completed, row }) => progress.push([completed, row.draft.name]),
  });
  assert.equal(maximum, 1);
  assert.deepEqual(progress, [[1, 'Рубашка'], [2, 'Брюки'], [3, 'Кеды']]);
  assert.equal(new Set(rows.map((row) => row.draft.id)).size, 3);
  rows[0].draft.colors.push('black');
  assert.deepEqual(rows[1].draft.colors, ['white']);
  assert.deepEqual(defaults.colors, ['white']);
});

test('oversized batches are rejected before processing, individual failures remain visible, and closing/account change stops the next file', async () => {
  let calls = 0;
  await assert.rejects(prepareBatchPhotos(Array.from({ length: MAX_BATCH_PHOTOS + 1 }, () => files[0]), {
    compress: async () => { calls++; return photo; },
  }), /от 1 до 20/);
  assert.equal(calls, 0);
  const rows = await prepareBatchPhotos(files.slice(0, 2), {
    compress: async () => { if (calls++ === 0) throw new Error('Damaged image'); return photo; },
  });
  assert.equal(rows[0].error, 'Damaged image');
  assert.equal(rows[0].draft.photo, '');
  assert.equal(rows[1].draft.photo, photo);
  calls = 0;
  await assert.rejects(prepareBatchPhotos(files, {
    compress: async () => { calls++; return photo; },
    shouldAbort: () => calls > 0,
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('a batch saves all garments once and undo restores its exact previous wardrobe', async () => {
  const writes = [];
  const closet = createClosetController({ load: async () => emptyState(), save: async (state) => writes.push(state) });
  await closet.initialize();
  await closet.update((state) => { addItemBatch(state, [draft('first'), draft('second')]); });
  assert.equal(writes.length, 1);
  assert.deepEqual(closet.snapshot().state.items.map((record) => record.id), ['first', 'second']);
  assert.equal(closet.snapshot().state.items[0].photo, photo);
  await closet.undo();
  assert.equal(writes.length, 2);
  assert.deepEqual(closet.snapshot().state, emptyState());
});

test('invalid rows, repeated IDs, existing IDs and capacity overflow reject the entire proposed batch before mutation', () => {
  for (const entries of [
    [draft('one'), { ...draft('two'), colors: [] }],
    [draft('one'), draft('one')],
    [draft('one'), { ...draft('two'), photo: '' }],
    [draft('existing')],
  ]) {
    const state = emptyState();
    state.items = [draft('existing')];
    const before = structuredClone(state);
    assert.throws(() => addItemBatch(state, entries));
    assert.deepEqual(state, before);
  }
  const full = emptyState();
  full.items = Array.from({ length: MAX_ITEMS }, (_, index) => draft(`owned-${index}`));
  assert.throws(() => addItemBatch(full, [draft('extra')]), /до 500 вещей/);
  assert.equal(full.items.length, MAX_ITEMS);
});

test('failed batch persistence never publishes a partial wardrobe and does not poison its retry', async () => {
  let fail = true;
  const closet = createClosetController({
    load: async () => emptyState(),
    save: async () => { if (fail) throw new Error('Storage unavailable'); },
  });
  await closet.initialize();
  const rows = [draft('first'), draft('second')];
  await assert.rejects(closet.update((state) => { addItemBatch(state, rows); }), /Storage unavailable/);
  assert.deepEqual(closet.snapshot().state, emptyState());
  fail = false;
  await closet.update((state) => { addItemBatch(state, rows); });
  assert.equal(closet.snapshot().state.items.length, 2);
});
