import test from 'node:test';
import assert from 'node:assert/strict';
import { filterShoppingList, SHOPPING_SORTS } from '../shopping-filters.mjs';

const entry = (id, changes = {}) => ({
  id, name: 'Белый свитер', category: 'top', colors: ['white'], season: 'winter',
  style: 'minimal', size: 'M', budget: null, notes: 'Шерсть, уютный трикотаж',
  status: 'planned', itemId: '', createdAt: '2026-10-27T10:00:00.000Z', ...changes
});
const ids = (items, filters) => filterShoppingList(items, filters).map(item => item.id);

test('status defaults to planned and combines with category and every query word', () => {
  const items = [
    entry('match'),
    entry('purchased', { status: 'purchased' }),
    entry('other-category', { category: 'dress' }),
    entry('missing-word', { notes: 'Хлопок' })
  ];
  assert.deepEqual(ids(items, { query: 'белый шерсть', category: 'top' }), ['match']);
  assert.deepEqual(ids(items, { query: 'белый шерсть', category: 'top', status: 'purchased' }), ['purchased']);
  assert.deepEqual(ids(items, { query: 'белый шерсть', category: 'top', status: 'all' }), ['match', 'purchased']);
  assert.deepEqual(ids(items, { query: 'белый шерсть', category: 'top', status: 'unknown' }), ['match']);
  assert.deepEqual(ids(items, { category: 'unknown' }), []);
});

test('search normalizes Russian case, ё/е, whitespace and composed Unicode', () => {
  const items = [entry('coat', { name: 'Тёплое пальто', notes: 'Зелёный воротник', category: 'outerwear' })];
  for (const query of ['  ТЕПЛОЕ   ЗЕЛЕНЫЙ\n', 'тёплое воротник', 'те\u0308плое']) assert.deepEqual(ids(items, { query }), ['coat']);
  assert.deepEqual(ids(items, { query: 'тёплое шёлк' }), []);
});

test('search includes size, raw style and translated style/category/color/season labels', () => {
  const items = [entry('minimal'), entry('classic', { style: 'classic', colors: ['black'], season: 'autumn', category: 'shoes', name: 'Лоферы', notes: '' })];
  assert.deepEqual(ids(items, { query: 'M minimal минимализм верх белый зима' }), ['minimal']);
  assert.deepEqual(ids(items, { query: 'classic классика обувь черный осень' }), ['classic']);
  assert.deepEqual(ids(items, { query: 'зима черный' }), []);
});

test('budget ordering keeps zero numeric and every unknown budget last in both directions', () => {
  const items = [entry('unknown', { budget: null }), entry('ten', { budget: 10 }), entry('zero', { budget: 0 }), entry('five', { budget: 5 }), entry('nan', { budget: NaN }), entry('infinite', { budget: Infinity }), entry('text', { budget: '3' }), entry('negative', { budget: -1 })];
  const unknown = ['infinite', 'nan', 'negative', 'text', 'unknown'];
  assert.deepEqual(ids(items, { sort: 'budget-asc' }), ['zero', 'five', 'ten', ...unknown]);
  assert.deepEqual(ids(items, { sort: 'budget-desc' }), ['ten', 'five', 'zero', ...unknown]);
});

test('budget ties use newest date then stable ID rather than incoming order', () => {
  const items = [entry('z', { budget: 100, createdAt: '2026-10-26T10:00:00.000Z' }), entry('b', { budget: 100 }), entry('a', { budget: 100 })];
  assert.deepEqual(ids(items, { sort: 'budget-asc' }), ['a', 'b', 'z']);
  assert.deepEqual(ids(items, { sort: 'budget-desc' }), ['a', 'b', 'z']);
});

test('newest and oldest are chronological and resolve identical timestamps by ID', () => {
  const items = [entry('z', { createdAt: '2026-10-26T10:00:00.000Z' }), entry('b'), entry('a')];
  assert.deepEqual(ids(items), ['a', 'b', 'z']);
  assert.deepEqual(ids(items, { sort: 'oldest' }), ['z', 'a', 'b']);
  assert.deepEqual(ids(items, { sort: 'unknown' }), ['a', 'b', 'z']);
});

test('name sorting uses Russian alphabetical order and natural numbers with date ties', () => {
  const items = [entry('z', { name: 'Яркий шарф' }), entry('a', { name: 'Блуза 10' }), entry('b', { name: 'Блуза 2' }), entry('c', { name: 'Блуза 2', createdAt: '2026-10-26T10:00:00.000Z' })];
  assert.deepEqual(ids(items, { sort: 'name' }), ['b', 'c', 'a', 'z']);
  assert.deepEqual(Object.keys(SHOPPING_SORTS), ['newest', 'oldest', 'name', 'budget-asc', 'budget-desc']);
});

test('filtering never changes the source array or records, and empty query returns a new array', () => {
  const items = [entry('b'), entry('a')];
  const before = structuredClone(items);
  const result = filterShoppingList(items);
  assert.notEqual(result, items); assert.equal(result[0], items[1]); assert.deepEqual(items, before);
  assert.deepEqual(ids(items, { query: '   ' }), ['a', 'b']);
  assert.deepEqual(filterShoppingList(undefined), []); assert.deepEqual(filterShoppingList(null), []); assert.deepEqual(filterShoppingList({}), []);
  assert.deepEqual(filterShoppingList([null, undefined, false, []]), []);
});
