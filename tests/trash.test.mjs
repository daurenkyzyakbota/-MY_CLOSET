import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, MAX_TRASH_RECORDS } from '../lib/data/model.js';
import { putItem, putOutfit, putPlan, putShopping, createClosetController } from '../lib/data/closet-state.js';
import { moveItemsToTrash, moveOutfitToTrash, restoreTrashEntry, clearTrash, permanentlyRemoveTrash } from '../lib/data/trash.js';

const photo = 'data:image/png;base64,iVBORw0KGgo=';
function fixture() {
  const state = emptyState();
  putItem(state, { id: 'shirt', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'], photo });
  putOutfit(state, { id: 'look', name: 'Мой образ', itemIds: ['shirt'] });
  putPlan(state, { id: 'plan', date: '2026-11-08', slot: 'day', outfitId: 'look' });
  putShopping(state, { id: 'purchase', name: 'Рубашка', category: 'top', status: 'purchased', itemId: 'shirt' });
  state.wearLog = [{ id: 'wear', date: '2026-11-01', outfitId: 'look', itemIds: ['shirt'], notes: '' }];
  return validateState(state);
}

test('v5 backups without optional trash default to an independent empty basket while retaining all personal records', () => {
  const original = fixture();
  delete original.trash;
  const migrated = validateState(original);
  assert.deepEqual(migrated.trash, []);
  assert.equal(Object.hasOwn(original, 'trash'), false);
  assert.equal(migrated.items[0].photo, photo);
  assert.deepEqual(migrated.wearLog, original.wearLog);
  const legacy = { version: 1, profile: { name: '', city: '', styles: '', colors: [] }, items: [], outfits: [], plans: [] };
  assert.deepEqual(validateState(legacy).trash, []);
  assert.throws(() => validateState({ ...legacy, trash: [] }), /неизвестное поле/);
});

test('garment deletion retains its exact photo and historical IDs, and restoration reconnects outfits and unchanged purchases', () => {
  const state = fixture();
  const item = structuredClone(state.items[0]);
  const historical = structuredClone({ outfits: state.outfits, plans: state.plans, wearLog: state.wearLog });
  const [entry] = moveItemsToTrash(state, ['shirt']);
  assert.equal(state.items.length, 0);
  assert.equal(state.shoppingList[0].itemId, '');
  assert.deepEqual(entry.record, item);
  assert.deepEqual({ outfits: state.outfits, plans: state.plans, wearLog: state.wearLog }, historical);
  const backup = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(backup.trash[0].record.photo, photo);
  restoreTrashEntry(backup, entry.id);
  assert.deepEqual(backup.items[0], item);
  assert.equal(backup.shoppingList[0].itemId, 'shirt');
  assert.equal(backup.trash.length, 0);
  assert.doesNotThrow(() => validateState(backup));
});

test('restoring a garment never overwrites a purchase link changed after its deletion', () => {
  const state = fixture();
  const [entry] = moveItemsToTrash(state, ['shirt']);
  state.shoppingList[0].itemId = 'another-garment';
  restoreTrashEntry(state, entry.id);
  assert.equal(state.shoppingList[0].itemId, 'another-garment');
});

test('outfit restoration restores old plans atomically, and an occupied slot requires an explicit choice without plans', () => {
  const state = fixture();
  const entry = moveOutfitToTrash(state, 'look');
  assert.equal(state.outfits.length, 0);
  assert.equal(state.plans.length, 0);
  assert.equal(entry.plans[0].id, 'plan');
  assert.equal(state.wearLog[0].outfitId, 'look');
  const simple = validateState(state);
  restoreTrashEntry(simple, entry.id);
  assert.equal(simple.outfits[0].id, 'look');
  assert.equal(simple.plans[0].id, 'plan');

  putOutfit(state, { id: 'new-look', name: 'Другой образ', itemIds: ['shirt'] });
  putPlan(state, { id: 'new-plan', date: '2026-11-08', slot: 'day', outfitId: 'new-look' });
  const before = structuredClone(state);
  assert.throws(() => restoreTrashEntry(state, entry.id), /уже занято/);
  assert.deepEqual(state, before);
  restoreTrashEntry(state, entry.id, { restorePlans: false });
  assert.equal(state.outfits.length, 2);
  assert.deepEqual(state.plans, before.plans);
  assert.equal(state.trash.length, 0);
});

test('a full basket, duplicate active ID and changed clear confirmation never partially remove data', () => {
  const state = fixture();
  const [entry] = moveItemsToTrash(state, ['shirt']);
  state.items.push(structuredClone(entry.record));
  let before = structuredClone(state);
  assert.throws(() => restoreTrashEntry(state, entry.id), /уже существует/);
  assert.deepEqual(state, before);
  state.trash = Array.from({ length: MAX_TRASH_RECORDS }, (_, index) => ({
    ...structuredClone(entry), id: `trash-${index}`, record: { ...structuredClone(entry.record), id: `removed-${index}` },
  }));
  before = structuredClone(state);
  assert.throws(() => moveItemsToTrash(state, ['shirt']), /В корзине/);
  assert.deepEqual(state, before);
  assert.throws(() => clearTrash(state, { expectedIds: ['outdated-confirmation'] }), /изменилась/);
  assert.deepEqual(state, before);
  permanentlyRemoveTrash(state, 'trash-0');
  assert.equal(state.trash.length, MAX_TRASH_RECORDS - 1);
  clearTrash(state, { expectedIds: state.trash.map((record) => record.id) });
  assert.deepEqual(state.trash, []);
});

test('trash validation rejects malformed records, foreign fields, invalid plans and unsafe images', () => {
  const state = fixture();
  moveItemsToTrash(state, ['shirt']);
  for (const modify of [
    (copy) => { copy.trash[0].unexpected = true; },
    (copy) => { copy.trash[0].type = 'unknown'; },
    (copy) => { copy.trash[0].deletedAt = 'bad'; },
    (copy) => { copy.trash[0].record.photo = 'https://foreign.invalid/image.png'; },
    (copy) => { copy.trash[0].plans = [{ id: 'x' }]; },
    (copy) => { copy.trash[0].shoppingIds = ['purchase', 'purchase']; },
    (copy) => { copy.items.push(structuredClone(copy.trash[0].record)); },
    (copy) => { copy.trash.push({ ...structuredClone(copy.trash[0]), id: 'duplicate-deletion' }); },
  ]) {
    const copy = structuredClone(state);
    modify(copy);
    assert.throws(() => validateState(copy));
    assert.equal(state.trash[0].record.photo, photo);
  }
});

test('failed deletion persistence leaves both the active wardrobe and basket unchanged', async () => {
  const state = fixture();
  const closet = createClosetController({ load: async () => state, save: async () => { throw new Error('Disk full'); } });
  await closet.initialize();
  await assert.rejects(closet.update((draft) => { moveItemsToTrash(draft, ['shirt']); }), /Disk full/);
  assert.deepEqual(closet.snapshot().state, state);
  assert.equal(closet.snapshot().canUndo, false);
});
