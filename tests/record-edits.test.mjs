import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState } from '../lib/data/model.js';
import {
  createClosetController,
  putItem,
  putOutfit,
  putPlan,
  putShopping,
} from '../lib/data/closet-state.js';
import { saveCapsule, saveTrip, toggleTripPacked } from '../lib/data/wardrobe-life.js';
import { assertRecordUnchanged } from '../lib/data/record-edits.js';

function wardrobe() {
  const state = emptyState();
  putItem(state, {
    id: 'shirt', name: 'Рубашка', category: 'top', colors: ['white'], seasons: ['summer'],
  });
  putOutfit(state, { id: 'look', name: 'На прогулку', itemIds: ['shirt'] });
  putPlan(state, { id: 'plan', date: '2026-11-01', slot: 'day', outfitId: 'look' });
  putShopping(state, { id: 'wish', name: 'Джинсы', category: 'bottom' });
  saveCapsule(state, { id: 'capsule', name: 'Базовая', itemIds: ['shirt'] });
  saveTrip(state, {
    id: 'trip', name: 'Выходные', startDate: '2026-11-07', endDate: '2026-11-08', itemIds: ['shirt'],
  });
  return validateState(state);
}

function controller(initial) {
  const writes = [];
  const published = [];
  return {
    writes,
    published,
    closet: createClosetController({
      load: async () => structuredClone(initial),
      save: async (value) => writes.push(structuredClone(value)),
    }, (view) => published.push(structuredClone(view.state))),
  };
}

test('record edit guards ignore unrelated changes and JSON property ordering while checking all editable collections', () => {
  const state = wardrobe();
  for (const collection of ['items', 'outfits', 'shoppingList', 'plans', 'capsules', 'trips']) {
    const expected = structuredClone(state[collection][0]);
    state.profile.name = 'Новое имя';
    const reordered = Object.fromEntries(Object.entries(expected).reverse());
    assert.doesNotThrow(() => assertRecordUnchanged(state, collection, expected.id, reordered));
    assert.doesNotThrow(() => assertRecordUnchanged(state, collection, 'new-record', null));
    assert.throws(() => assertRecordUnchanged(state, collection, expected.id, null), {
      code: 'LOCAL_RECORD_CONFLICT',
    });
    state[collection] = [];
    assert.throws(() => assertRecordUnchanged(state, collection, expected.id, expected), {
      code: 'LOCAL_RECORD_CONFLICT',
    });
  }
});

test('an open garment editor cannot overwrite a later synced record or recreate its deleted ID', async () => {
  for (const remove of [false, true]) {
    const { closet, writes, published } = controller(wardrobe());
    await closet.initialize();
    const expected = closet.snapshot().state.items[0];
    await closet.update((state) => {
      if (remove) state.items = [];
      else state.items[0].notes = 'Обновлено на другом устройстве';
    });
    const current = structuredClone(closet.snapshot().state);
    await assert.rejects(closet.update((state) => {
      assertRecordUnchanged(state, 'items', expected.id, expected);
      putItem(state, { ...expected, name: 'Старый редактор' });
    }), { code: 'LOCAL_RECORD_CONFLICT' });
    assert.deepEqual(closet.snapshot().state, current);
    assert.equal(writes.length, 1);
    assert.equal(published.length, 2);
  }
});

test('two editors opened on one record serialize without allowing the second draft to erase the first save', async () => {
  const { closet, writes } = controller(wardrobe());
  await closet.initialize();
  const expected = closet.snapshot().state.outfits[0];
  const edit = (name) => closet.update((state) => {
    assertRecordUnchanged(state, 'outfits', expected.id, expected);
    putOutfit(state, { ...expected, name });
  });
  const results = await Promise.allSettled([edit('Первый редактор'), edit('Второй редактор')]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'LOCAL_RECORD_CONFLICT');
  assert.equal(closet.snapshot().state.outfits[0].name, 'Первый редактор');
  assert.equal(writes.length, 1);
});

test('saving an old trip form cannot uncheck newly packed garments', async () => {
  const { closet, writes } = controller(wardrobe());
  await closet.initialize();
  const expected = closet.snapshot().state.trips[0];
  await closet.update((state) => { toggleTripPacked(state, 'trip', 'shirt'); });
  await assert.rejects(closet.update((state) => {
    assertRecordUnchanged(state, 'trips', expected.id, expected);
    saveTrip(state, { ...expected, notes: 'Старая форма' });
  }), { code: 'LOCAL_RECORD_CONFLICT' });
  assert.deepEqual(closet.snapshot().state.trips[0].packedItemIds, ['shirt']);
  assert.equal(writes.length, 1);
});

test('record guards leave normal new drafts and independent records editable', async () => {
  const { closet, writes } = controller(wardrobe());
  await closet.initialize();
  const expected = closet.snapshot().state.items[0];
  await closet.update((state) => {
    state.shoppingList[0].notes = 'Другая запись';
  });
  await closet.update((state) => {
    assertRecordUnchanged(state, 'items', expected.id, expected);
    putItem(state, { ...expected, name: 'Новая рубашка' });
    assertRecordUnchanged(state, 'outfits', 'new-look', null);
    putOutfit(state, { id: 'new-look', name: 'Новый образ', itemIds: ['shirt'] });
  });
  assert.equal(closet.snapshot().state.items[0].name, 'Новая рубашка');
  assert.equal(closet.snapshot().state.outfits.length, 2);
  assert.equal(writes.length, 2);
});

test('duplicate wishlist validation is atomic for queued writes, including normalized names and reordered colors', async () => {
  const { closet, writes } = controller(emptyState());
  await closet.initialize();
  const first = closet.update((state) => {
    putShopping(state, {
      id: 'first',
      name: ' Белая   рубашка ',
      category: 'top',
      size: ' m ',
      colors: ['white', 'beige'],
    });
  });
  const second = closet.update((state) => {
    putShopping(state, {
      id: 'second',
      name: 'БЕЛАЯ РУБАШКА',
      category: 'top',
      size: 'M',
      colors: ['beige', 'white'],
    });
  });
  const result = await Promise.allSettled([first, second]);
  assert.equal(result[0].status, 'fulfilled');
  assert.equal(result[1].status, 'rejected');
  assert.match(result[1].reason.message, /уже есть в планах/);
  assert.equal(closet.snapshot().state.shoppingList.length, 1);
  assert.equal(writes.length, 1);
});

test('wishlist guard permits its own edits, distinct sizes/colors/categories and historical purchased entries', () => {
  const state = emptyState();
  const draft = { id: 'first', name: 'Рубашка', category: 'top', size: 'M', colors: ['white'] };
  putShopping(state, draft);
  putShopping(state, { ...draft, notes: 'Обновлённая заметка' });
  putShopping(state, { ...draft, id: 'larger', size: 'L' });
  putShopping(state, { ...draft, id: 'blue', colors: ['blue'] });
  putShopping(state, { ...draft, id: 'another-category', category: 'outerwear' });
  putShopping(state, { ...draft, id: 'historical', status: 'purchased' });
  assert.equal(state.shoppingList.length, 5);
  assert.equal(state.shoppingList[0].notes, 'Обновлённая заметка');
  assert.doesNotThrow(() => validateState(state));
});
