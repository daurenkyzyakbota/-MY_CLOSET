import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../lib/data/model.js';
import { createClosetController, putItem } from '../lib/data/closet-state.js';
import { moveItemsToTrash } from '../lib/data/trash.js';

const garment = { id: 'shirt', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'] };
function fixture() {
  const writes = [];
  const closet = createClosetController({
    load: async () => emptyState(),
    save: async (state) => { writes.push(structuredClone(state)); },
  });
  return { closet, writes };
}

test('undo restores the exact last persisted change including basket/photos, and cannot toggle back as redo', async () => {
  const { closet, writes } = fixture();
  await closet.initialize();
  await closet.update((state) => { putItem(state, garment); }, { label: 'Добавление вещи' });
  const beforeDelete = structuredClone(closet.snapshot().state);
  await closet.update((state) => { moveItemsToTrash(state, ['shirt']); }, { label: 'Удаление вещи' });
  assert.equal(closet.snapshot().undoLabel, 'Удаление вещи');
  await closet.undo();
  assert.deepEqual(closet.snapshot().state, beforeDelete);
  assert.equal(closet.snapshot().canUndo, false);
  assert.equal(writes.length, 3);
  await assert.rejects(closet.undo(), /больше нельзя отменить/);
  assert.equal(writes.length, 3);
});

test('a queued newer action prevents an old undo click from reverting the wrong action', async () => {
  const { closet } = fixture();
  await closet.initialize();
  await closet.update((state) => { putItem(state, garment); });
  const newer = closet.update((state) => { state.profile.name = 'Новое имя'; });
  const staleUndo = closet.undo();
  await newer;
  await assert.rejects(staleUndo, /больше нельзя отменить/);
  assert.equal(closet.snapshot().state.profile.name, 'Новое имя');
  assert.equal(closet.snapshot().state.items.length, 1);
});

test('silent remote replacement clears local undo, while no-op changes keep a useful undo available', async () => {
  const { closet } = fixture();
  await closet.initialize();
  await closet.update((state) => { putItem(state, garment); });
  await closet.update(() => {});
  assert.equal(closet.snapshot().canUndo, true);
  await closet.update((state) => { state.profile.name = 'Из облака'; }, { undo: false });
  assert.equal(closet.snapshot().canUndo, false);
  await assert.rejects(closet.undo());
  assert.equal(closet.snapshot().state.profile.name, 'Из облака');
});

test('account guards and failed undo persistence cannot change published state or discard the undo record', async () => {
  let fail = false;
  const closet = createClosetController({
    load: async () => emptyState(),
    save: async () => { if (fail) throw new Error('Disk full'); },
  });
  await closet.initialize();
  await closet.update((state) => { putItem(state, garment); });
  const before = structuredClone(closet.snapshot().state);
  await assert.rejects(closet.undo({ assertCurrent: () => { throw new DOMException('Account changed', 'AbortError'); } }), { name: 'AbortError' });
  assert.deepEqual(closet.snapshot().state, before);
  fail = true;
  await assert.rejects(closet.undo(), /Disk full/);
  assert.deepEqual(closet.snapshot().state, before);
  assert.equal(closet.snapshot().canUndo, true);
  fail = false;
  await closet.undo();
  assert.deepEqual(closet.snapshot().state, emptyState());
});
