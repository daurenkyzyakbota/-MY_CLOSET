import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, COLORS, SEASONS, filterItems } from '../lib/data/model.js';
import { SHOPPING_SORTS, filterShoppingList } from '../lib/styling/shopping-filters.js';
import {
  LIST_PREFERENCE_KEYS,
  WARDROBE_PREFERENCES,
  SHOPPING_PREFERENCES,
  sanitizeWardrobePreferences,
  sanitizeShoppingPreferences,
  wardrobeUrlOverrides,
  readListPreferences,
  writeListPreferences,
  withoutWardrobeUrlFilters,
} from '../lib/data/list-preferences.js';

function memoryStorage() {
  const records = new Map();
  return {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
}
const wardrobe = (value) => sanitizeWardrobePreferences(value, ['Мой повседневный', 'casual']);

test('wardrobe, favorites and shopping restore independent tab preferences', () => {
  const storage = memoryStorage();
  const saved = {
    query: 'лён',
    category: 'top',
    color: 'white',
    season: 'summer',
    style: 'Мой повседневный',
    availability: 'available',
    sort: 'name',
  };
  const favorite = { ...WARDROBE_PREFERENCES, color: 'black', sort: 'favorites' };
  const shopping = { query: 'пальто', category: 'outerwear', status: 'all', sort: 'budget-desc' };
  assert.equal(new Set(Object.values(LIST_PREFERENCE_KEYS)).size, 3);
  assert.equal(writeListPreferences(storage, LIST_PREFERENCE_KEYS.wardrobe, saved), true);
  writeListPreferences(storage, LIST_PREFERENCE_KEYS.favorites, favorite);
  writeListPreferences(storage, LIST_PREFERENCE_KEYS.shopping, shopping);
  assert.deepEqual(readListPreferences(storage, LIST_PREFERENCE_KEYS.wardrobe, wardrobe), saved);
  assert.deepEqual(
    readListPreferences(storage, LIST_PREFERENCE_KEYS.favorites, wardrobe),
    favorite,
  );
  assert.deepEqual(
    readListPreferences(storage, LIST_PREFERENCE_KEYS.shopping, sanitizeShoppingPreferences),
    shopping,
  );
});

test('explicit URL filters override only the named saved filters, including empty query', () => {
  const storage = memoryStorage();
  const saved = {
    ...WARDROBE_PREFERENCES,
    query: 'блуза',
    category: 'top',
    color: 'white',
    sort: 'name',
  };
  writeListPreferences(storage, 'view', saved);
  const read = (search) =>
    readListPreferences(storage, 'view', wardrobe, wardrobeUrlOverrides(search));
  assert.deepEqual(read('?category=shoes'), { ...saved, category: 'shoes' });
  assert.deepEqual(read('?q='), { ...saved, query: '' });
  assert.deepEqual(read('?q=джинсы'), { ...saved, query: 'джинсы' });
  assert.deepEqual(read('?category=removed'), { ...saved, category: '' });
  assert.deepEqual(read('?other=1'), saved);
});

test('stale enum values fall back safely instead of hiding all records', () => {
  const bad = {
    query: 12,
    category: '__proto__',
    color: 'invisible',
    season: 'monsoon',
    availability: 'deleted',
    style: 'removed',
    sort: 'price',
  };
  assert.deepEqual(wardrobe(bad), WARDROBE_PREFERENCES);
  assert.equal(
    filterItems(
      [
        {
          name: 'Топ',
          category: 'top',
          colors: ['white'],
          seasons: ['summer'],
          style: '',
          available: true,
        },
      ],
      wardrobe(bad),
    ).length,
    1,
  );
  const shopping = sanitizeShoppingPreferences({
    category: 'removed',
    status: 'removed',
    sort: 'removed',
  });
  assert.deepEqual(shopping, SHOPPING_PREFERENCES);
  assert.equal(
    filterShoppingList([{ name: 'Топ', category: 'top', colors: [], status: 'planned' }], shopping)
      .length,
    1,
  );
});

test('every current category/color/season/sort option remains supported', () => {
  for (const category of Object.keys(CATEGORIES)) {
    assert.equal(wardrobe({ category }).category, category);
    assert.equal(sanitizeShoppingPreferences({ category }).category, category);
  }
  for (const color of Object.keys(COLORS)) assert.equal(wardrobe({ color }).color, color);
  for (const season of Object.keys(SEASONS)) assert.equal(wardrobe({ season }).season, season);
  for (const sort of Object.keys(SHOPPING_SORTS))
    assert.equal(sanitizeShoppingPreferences({ sort }).sort, sort);
  for (const sort of ['newest', 'oldest', 'name', 'favorites'])
    assert.equal(wardrobe({ sort }).sort, sort);
  for (const status of ['planned', 'purchased', 'all'])
    assert.equal(sanitizeShoppingPreferences({ status }).status, status);
});

test('free-text wardrobe style survives when present and clears after its last garment is removed', () => {
  const source = { ...WARDROBE_PREFERENCES, style: 'Мой повседневный', query: 'лён' };
  assert.equal(sanitizeWardrobePreferences(source, ['Мой повседневный']).style, 'Мой повседневный');
  assert.deepEqual(sanitizeWardrobePreferences(source, ['casual']), { ...source, style: '' });
  assert.equal(source.style, 'Мой повседневный');
});

test('query sizes follow the visible input limits without changing ordinary text', () => {
  assert.equal(wardrobe({ query: 'а'.repeat(300) }).query.length, 200);
  assert.equal(sanitizeShoppingPreferences({ query: 'а'.repeat(300) }).query.length, 120);
  assert.equal(wardrobeUrlOverrides(`?q=${'а'.repeat(300)}`).query.length, 200);
  assert.equal(wardrobe({ query: '  Платье Ёлка ' }).query, '  Платье Ёлка ');
  assert.equal(sanitizeShoppingPreferences({ query: { toString: () => 'unexpected' } }).query, '');
});

test('blocked, malformed, missing and oversized storage never prevent usable defaults', () => {
  const blocked = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.deepEqual(readListPreferences(blocked, 'view', wardrobe), WARDROBE_PREFERENCES);
  assert.equal(writeListPreferences(blocked, 'view', WARDROBE_PREFERENCES), false);
  assert.equal(writeListPreferences(null, 'view', WARDROBE_PREFERENCES), false);
  for (const raw of [
    null,
    '{broken',
    '[]',
    'null',
    'true',
    '17',
    '"query"',
    '{"query":"' + 'x'.repeat(5000) + '"}',
  ]) {
    assert.deepEqual(
      readListPreferences({ getItem: () => raw }, 'view', wardrobe),
      WARDROBE_PREFERENCES,
    );
  }
  assert.deepEqual(
    readListPreferences(blocked, 'view', wardrobe, wardrobeUrlOverrides('?q=платье')),
    { ...WARDROBE_PREFERENCES, query: 'платье' },
  );
});

test('saved reset clears wardrobe filters and retains the chosen shopping tab', () => {
  const storage = memoryStorage();
  writeListPreferences(storage, LIST_PREFERENCE_KEYS.wardrobe, {
    ...WARDROBE_PREFERENCES,
    query: 'топ',
    color: 'black',
  });
  writeListPreferences(storage, LIST_PREFERENCE_KEYS.wardrobe, WARDROBE_PREFERENCES);
  assert.deepEqual(
    readListPreferences(storage, LIST_PREFERENCE_KEYS.wardrobe, wardrobe),
    WARDROBE_PREFERENCES,
  );
  const old = { query: 'платье', category: 'dress', status: 'purchased', sort: 'name' };
  const reset = sanitizeShoppingPreferences({ ...old, query: '', category: '', sort: 'newest' });
  writeListPreferences(storage, LIST_PREFERENCE_KEYS.shopping, reset);
  assert.deepEqual(
    readListPreferences(storage, LIST_PREFERENCE_KEYS.shopping, sanitizeShoppingPreferences),
    { ...SHOPPING_PREFERENCES, status: 'purchased' },
  );
});

test('editing or resetting deep-link filters preserves unrelated parameters and anchor', () => {
  const href =
    'https://mycloset.example/wardrobe?q=%D0%BB%D1%91%D0%BD&category=top&from=home#recent';
  const queryOnly = new URL(withoutWardrobeUrlFilters(href, ['query']), href);
  assert.equal(queryOnly.searchParams.has('q'), false);
  assert.equal(queryOnly.searchParams.get('category'), 'top');
  const reset = new URL(withoutWardrobeUrlFilters(href), href);
  assert.equal(reset.pathname, '/wardrobe');
  assert.equal(reset.searchParams.get('from'), 'home');
  assert.equal(reset.searchParams.has('category'), false);
  assert.equal(reset.hash, '#recent');
});

test('sanitizers drop unexpected properties and never mutate the source', () => {
  const source = { ...WARDROBE_PREFERENCES, color: 'blue', unknown: { nested: true } };
  const before = structuredClone(source);
  const result = wardrobe(source);
  assert.notEqual(result, source);
  assert.equal(Object.hasOwn(result, 'unknown'), false);
  assert.deepEqual(source, before);
  for (const invalid of [null, undefined, [], false, 'saved']) {
    assert.deepEqual(wardrobe(invalid), WARDROBE_PREFERENCES);
    assert.deepEqual(sanitizeShoppingPreferences(invalid), SHOPPING_PREFERENCES);
  }
});
