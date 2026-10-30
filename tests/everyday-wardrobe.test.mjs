import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState } from '../lib/data/model.js';
import { createClosetController } from '../lib/data/closet-state.js';
import { applyItemBatch } from '../lib/data/item-actions.js';
import { createWardrobeCsv, csvCell } from '../lib/data/wardrobe-csv.js';
import { findOwnedAlternatives, ownedAlternativeHref } from '../lib/styling/purchase-check.js';
import {
  LIST_PREFERENCE_KEYS,
  WARDROBE_PREFERENCES,
  SHOPPING_PREFERENCES,
  scopedListPreferenceKey,
  readListPreferences,
  writeListPreferences,
  sanitizeWardrobePreferences,
  sanitizeShoppingPreferences,
  wardrobeUrlOverrides,
  withoutWardrobeUrlFilters,
  shoppingUrlOverrides,
  withoutShoppingUrlQuery,
} from '../lib/data/list-preferences.js';

const createdAt = '2026-10-30T10:00:00.000Z';
const garment = (item) => ({
  size: '',
  style: '',
  favorite: false,
  available: true,
  photo: '',
  warmth: 'unknown',
  rainproof: 'unknown',
  subcategory: '',
  material: '',
  brand: '',
  notes: '',
  purchaseDate: '',
  ...item,
});
function fixture() {
  return validateState({
    ...emptyState(),
    profile: { ...emptyState().profile, name: 'Private profile name' },
    items: [
      {
        id: 'shirt',
        name: 'Рубашка',
        category: 'top',
        colors: ['white'],
        seasons: ['summer'],
        createdAt,
        photo: 'data:image/png;base64,iVBORw0KGgo=',
      },
      {
        id: 'jeans',
        name: 'Джинсы',
        category: 'bottom',
        colors: ['blue'],
        seasons: ['summer'],
        createdAt,
      },
      {
        id: 'other-shirt',
        name: 'Другая рубашка',
        category: 'top',
        colors: ['white'],
        seasons: ['winter'],
        available: false,
        createdAt,
      },
    ].map(garment),
    outfits: [
      {
        id: 'look',
        name: 'Образ',
        itemIds: ['shirt', 'jeans'],
        favorite: false,
        occasion: 'everyday',
        style: '',
        season: '',
        description: '',
        missingItems: [],
        createdAt,
      },
    ],
    plans: [{ id: 'plan', date: '2026-10-31', slot: 'day', outfitId: 'look' }],
    shoppingList: [
      {
        id: 'wish',
        name: 'Белая рубашка',
        category: 'top',
        colors: ['white'],
        season: '',
        style: '',
        size: '',
        budget: 0,
        notes: '',
        status: 'purchased',
        itemId: 'shirt',
        createdAt,
      },
    ],
    wearLog: [
      {
        id: 'wear',
        date: '2026-10-30',
        itemIds: ['shirt', 'jeans'],
        outfitId: 'look',
        notes: 'Actual wear',
      },
    ],
    capsules: [
      {
        id: 'capsule',
        name: 'Капсула',
        description: '',
        itemIds: ['shirt'],
        outfitIds: ['look'],
        createdAt,
      },
    ],
    trips: [
      {
        id: 'trip',
        name: 'Поездка',
        destination: 'Алматы',
        startDate: '2026-11-01',
        endDate: '2026-11-02',
        itemIds: ['shirt'],
        outfitIds: ['look'],
        packedItemIds: ['shirt'],
        notes: '',
        createdAt,
      },
    ],
  });
}

function csvRows(source) {
  const rows = [];
  let row = [],
    value = '',
    quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if (char === '\r' && source[index + 1] === '\n' && !quoted) {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      index++;
    } else value += char;
  }
  assert.equal(quoted, false);
  return rows;
}

test('batch actions explicitly set state and leave unselected items untouched', () => {
  const state = fixture();
  const untouched = structuredClone(state.items[2]);
  assert.deepEqual(applyItemBatch(state, ['shirt', 'jeans'], 'favorite'), {
    count: 2,
    changedCount: 2,
  });
  assert.deepEqual(applyItemBatch(state, ['shirt', 'jeans'], 'favorite'), {
    count: 2,
    changedCount: 0,
  });
  applyItemBatch(state, ['shirt'], 'unfavorite');
  applyItemBatch(state, ['shirt', 'jeans'], 'laundry');
  applyItemBatch(state, ['jeans'], 'available');
  assert.deepEqual(
    state.items.map((item) => [item.id, item.favorite, item.available]),
    [
      ['shirt', false, false],
      ['jeans', true, true],
      ['other-shirt', false, false],
    ],
  );
  assert.deepEqual(state.items[2], untouched);
  validateState(state);
});

test('all batch IDs are checked before any item is changed', () => {
  for (const action of ['favorite', 'unfavorite', 'laundry', 'available', 'delete']) {
    const state = fixture();
    const original = structuredClone(state);
    assert.throws(() => applyItemBatch(state, ['shirt', 'missing'], action), /уже удалена/);
    assert.deepEqual(state, original);
  }
});

test('invalid and repeated selections never mutate the draft', () => {
  for (const ids of [
    [],
    ['shirt', 'shirt'],
    ['../shirt'],
    [null],
    'shirt',
    Array.from({ length: 501 }, (_, i) => 'id' + i),
  ]) {
    const state = fixture();
    const original = structuredClone(state);
    assert.throws(() => applyItemBatch(state, ids, 'favorite'));
    assert.deepEqual(state, original);
  }
  assert.throws(() => applyItemBatch(fixture(), ['shirt'], '__proto__'));
});

test('batch deletion retains historical outfit, calendar, wear, capsule and packing references', () => {
  const state = fixture();
  const history = structuredClone({
    outfits: state.outfits,
    plans: state.plans,
    wearLog: state.wearLog,
    capsules: state.capsules,
    trips: state.trips,
  });
  applyItemBatch(state, ['shirt', 'jeans'], 'delete');
  assert.deepEqual(
    state.items.map((item) => item.id),
    ['other-shirt'],
  );
  assert.equal(state.shoppingList[0].itemId, '');
  for (const [key, value] of Object.entries(history)) assert.deepEqual(state[key], value);
  validateState(state);
});

test('a batch publishes and persists once, after the complete write succeeds', async () => {
  let finish;
  const saved = [];
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const controller = createClosetController({
    load: async () => fixture(),
    save: async (state) => {
      saved.push(structuredClone(state));
      await gate;
    },
  });
  await controller.initialize();
  const pending = controller.update((state) => {
    applyItemBatch(state, ['shirt', 'jeans'], 'laundry');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].items[0].available, false);
  assert.equal(saved[0].items[1].available, false);
  assert.equal(controller.snapshot().state.items[0].available, true);
  finish();
  await pending;
  assert.equal(controller.snapshot().state.items[0].available, false);
});

test('failed batch persistence leaves every visible record unchanged', async () => {
  const before = fixture();
  const controller = createClosetController({
    load: async () => before,
    save: async () => {
      throw new Error('Disk full');
    },
  });
  await controller.initialize();
  await assert.rejects(
    controller.update((state) => {
      applyItemBatch(state, ['shirt', 'jeans'], 'delete');
    }),
    /Disk full/,
  );
  assert.deepEqual(controller.snapshot().state, before);
});

test('queued independent batches preserve each other instead of using stale snapshots', async () => {
  const writes = [];
  const controller = createClosetController({
    load: async () => fixture(),
    save: async (state) => writes.push(structuredClone(state)),
  });
  await controller.initialize();
  await Promise.all([
    controller.update((state) => {
      applyItemBatch(state, ['shirt'], 'favorite');
    }),
    controller.update((state) => {
      applyItemBatch(state, ['shirt'], 'laundry');
    }),
  ]);
  assert.equal(writes.length, 2);
  assert.equal(controller.snapshot().state.items[0].favorite, true);
  assert.equal(controller.snapshot().state.items[0].available, false);
});

test('CSV keeps filtered order, Cyrillic, quotes and multiline values without exporting photos or profile', () => {
  const state = fixture();
  state.items[0].name = 'Рубашка, "лён"\r\nВторая строка';
  state.items[0].brand = '  =HYPERLINK("bad")';
  const csv = createWardrobeCsv(state, ['jeans', 'shirt'], '2026-10-31');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.endsWith('\r\n'));
  const rows = csvRows(csv.slice(1));
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'jeans');
  assert.equal(rows[2][1], state.items[0].name);
  assert.equal(rows[2][6], "'" + state.items[0].brand);
  assert.equal(rows[1].length, rows[0].length);
  assert.ok(!csv.includes('data:image'));
  assert.ok(!csv.includes(state.profile.name));
});

test('spreadsheet formulas and leading control prefixes are exported as text', () => {
  for (const value of [
    '=1+1',
    '+1',
    '-1',
    '@SUM(1)',
    '  =1',
    '\t=1',
    '\r\n+2',
    '\u0000=1',
    '\uFEFF@x',
    '\u200b=1',
  ])
    assert.equal(csvRows(csvCell(value) + '\r\n')[0][0], "'" + value);
  for (const value of ['Белая рубашка', 'Модель = x', 'Цена, размер', 'Кавычки "да"'])
    assert.equal(csvRows(csvCell(value) + '\r\n')[0][0], value);
});

test('CSV wear statistics count actual past marks and ignore calendar plans and future marks', () => {
  const state = fixture();
  state.wearLog.push(
    { id: 'wear2', date: '2026-10-31', itemIds: ['shirt'], outfitId: '', notes: '' },
    { id: 'future', date: '2026-11-01', itemIds: ['shirt'], outfitId: '', notes: '' },
  );
  const rows = csvRows(createWardrobeCsv(state, ['shirt'], '2026-10-31').slice(1));
  assert.equal(rows[1][rows[0].indexOf('Количество носок')], '2');
  assert.equal(rows[1][rows[0].indexOf('Последняя носка')], '2026-10-31');
  assert.throws(() => createWardrobeCsv(state, ['deleted']));
});

test('wishlist alternatives use actual matching category/color and retain laundry status', () => {
  const state = fixture();
  const entry = { name: 'Белая рубашка', category: 'top', colors: ['white'], itemId: '' };
  const original = structuredClone(state.items);
  const matches = findOwnedAlternatives(entry, state.items);
  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((match) => match.item.id),
    ['shirt', 'other-shirt'],
  );
  assert.equal(matches[1].item.available, false);
  assert.deepEqual(matches[0].colors, ['white']);
  assert.deepEqual(state.items, original);
  assert.equal(findOwnedAlternatives({ ...entry, colors: ['black'] }, state.items).length, 0);
  assert.equal(
    findOwnedAlternatives({ ...entry, category: 'dress', colors: [] }, state.items).length,
    0,
  );
  assert.equal(
    findOwnedAlternatives({ ...entry, itemId: 'shirt' }, state.items)[0].item.id,
    'other-shirt',
  );
});

test('wishlist colorless matches make only a category claim and links reset hiding filters', () => {
  const state = fixture();
  const matches = findOwnedAlternatives({ category: 'top', colors: [] }, state.items, 1);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].reason, 'Та же категория');
  const link = new URL(ownedAlternativeHref(matches[0].item), 'https://mycloset.example');
  assert.equal(link.searchParams.get('reset'), '1');
  assert.equal(link.searchParams.get('q'), matches[0].item.name);
});

test('account list preferences remain independent while the old guest key survives', () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key),
    setItem: (key, value) => records.set(key, value),
  };
  const guest = LIST_PREFERENCE_KEYS.wardrobe;
  const first = scopedListPreferenceKey(guest, 'owner-first');
  const second = scopedListPreferenceKey(guest, 'owner-second');
  assert.equal(scopedListPreferenceKey(guest, ''), guest);
  writeListPreferences(storage, guest, { ...WARDROBE_PREFERENCES, query: 'Guest query' });
  writeListPreferences(storage, first, { ...WARDROBE_PREFERENCES, query: 'Private query' });
  assert.equal(
    readListPreferences(storage, first, sanitizeWardrobePreferences).query,
    'Private query',
  );
  assert.equal(readListPreferences(storage, second, sanitizeWardrobePreferences).query, '');
  assert.equal(
    readListPreferences(storage, guest, sanitizeWardrobePreferences).query,
    'Guest query',
  );
  assert.notEqual(first, scopedListPreferenceKey(LIST_PREFERENCE_KEYS.shopping, 'owner-first'));
  assert.throws(() => scopedListPreferenceKey(guest, '../owner'));
});

test('shopping deep links search all statuses and clear category while manual editing removes stale q', () => {
  const override = shoppingUrlOverrides('?q=Кеды');
  assert.deepEqual(override, { query: 'Кеды', category: '', status: 'all' });
  const value = sanitizeShoppingPreferences({
    ...SHOPPING_PREFERENCES,
    category: 'dress',
    status: 'purchased',
    ...override,
  });
  assert.equal(value.category, '');
  assert.equal(value.status, 'all');
  assert.deepEqual(shoppingUrlOverrides('?other=1'), {});
  assert.equal(shoppingUrlOverrides('?q=').query, '');
  assert.equal(shoppingUrlOverrides('?q=' + 'a'.repeat(200)).query.length, 120);
  assert.equal(
    withoutShoppingUrlQuery('https://mycloset.example/shopping-list?q=old&from=home#list'),
    '/shopping-list?from=home#list',
  );
});

test('wardrobe reset and availability deep links cannot silently retain old hiding filters', () => {
  const overrides = wardrobeUrlOverrides(
    '?reset=1&q=Рубашка&category=top&availability=unavailable',
  );
  assert.deepEqual(overrides, {
    ...WARDROBE_PREFERENCES,
    query: 'Рубашка',
    category: 'top',
    availability: 'laundry',
  });
  assert.deepEqual(wardrobeUrlOverrides('?availability=available'), { availability: 'available' });
  assert.deepEqual(wardrobeUrlOverrides('?availability=fake'), { availability: '' });
  assert.equal(
    withoutWardrobeUrlFilters(
      'https://mycloset.example/wardrobe?reset=1&availability=unavailable&q=coat&from=home#list',
      ['availability'],
    ),
    '/wardrobe?q=coat&from=home#list',
  );
});
