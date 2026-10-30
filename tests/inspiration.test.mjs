import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPublishedOutfit } from '../lib/styling/inspiration.js';
import { demoState, validateState } from '../lib/data/model.js';
import { putOutfit } from '../lib/data/closet-state.js';

const garment = (id, category, colors, extra = {}) => ({
  id,
  name: id,
  category,
  colors,
  available: true,
  favorite: false,
  ...extra,
});
const published = (items) => ({
  name: 'Вдохновение',
  occasion: 'walk',
  style: 'minimal',
  season: 'summer',
  items,
});

test('global matching preserves scarce exact colors instead of greedy duplication', () => {
  const source = published([
    garment('foreign-wide', 'top', ['white', 'blue']),
    garment('foreign-white', 'top', ['white']),
  ]);
  const own = [garment('own-white', 'top', ['white']), garment('own-blue', 'top', ['blue'])];
  const result = matchPublishedOutfit(source, own);
  assert.deepEqual(
    result.matches.map((row) => row.item.id),
    ['own-blue', 'own-white'],
  );
  assert.equal(result.approximateCount, 1);
  assert.equal(new Set(result.draft.itemIds).size, 2);
});

test('laundry and other categories are never used, and missing pieces explain the reason', () => {
  const source = published([
    garment('foreign-top', 'top', ['white']),
    garment('foreign-shoes', 'shoes', ['black']),
  ]);
  const own = [
    garment('own-top', 'top', ['white']),
    garment('laundry', 'shoes', ['black'], { available: false }),
    garment('different-category', 'accessory', ['black']),
  ];
  const result = matchPublishedOutfit(source, own);
  assert.deepEqual(result.draft.itemIds, ['own-top']);
  assert.equal(result.draft.missingItems[0].category, 'shoes');
  assert.match(result.draft.missingItems[0].reason, /стирке|недоступны/);
  assert.equal(result.matches[1].item, null);
});

test('different color is an explicit approximation and an unspecified palette is not an exact match', () => {
  const result = matchPublishedOutfit(
    published([garment('foreign', 'top', ['white']), garment('foreign-shoes', 'shoes', [])]),
    [garment('own-red', 'top', ['red']), garment('own-shoes', 'shoes', ['black'])],
  );
  assert.equal(result.matches[0].colorStatus, 'different');
  assert.match(result.matches[0].explanation, /отличается/);
  assert.equal(result.matches[1].colorStatus, 'unspecified');
  assert.equal(result.approximateCount, 1);
  assert.ok(result.warnings.length);
});

test('draft contains only owned IDs and new missing metadata, without copying foreign photos or private fields', () => {
  const snapshot = published([
    garment('foreign-top', 'top', ['white'], {
      photo: 'FOREIGN-PHOTO',
      notes: 'FOREIGN-NOTE',
      brand: 'Foreign brand',
    }),
    garment('foreign-shoes', 'shoes', ['black'], { photo: 'OTHER-FOREIGN-PHOTO' }),
  ]);
  const items = [
    garment('own-top', 'top', ['white'], { photo: 'OWN-PHOTO', notes: 'MY-PRIVATE-NOTE' }),
  ];
  const before = JSON.stringify({ snapshot, items });
  const result = matchPublishedOutfit(snapshot, items);
  assert.deepEqual(result.draft.itemIds, ['own-top']);
  assert.notEqual(result.draft.missingItems[0].id, 'foreign-shoes');
  assert.ok(!JSON.stringify(result.draft).includes('PHOTO'));
  assert.ok(!JSON.stringify(result.draft).includes('NOTE'));
  assert.equal(JSON.stringify({ snapshot, items }), before);
});

test('every generated ready draft passes the actual v5 outfit validator', () => {
  const state = demoState();
  const own = state.items[0];
  const snapshot = published([
    garment('published-one', own.category, own.colors),
    garment('missing-one', 'shoes', ['black']),
  ]);
  state.items = state.items.filter((item) => item.category !== 'shoes');
  state.outfits = [];
  state.plans = [];
  const result = matchPublishedOutfit(snapshot, state.items, { title: 'Оригинальный образ' });
  assert.ok(result.canCreate);
  putOutfit(state, result.draft);
  assert.equal(validateState(state).version, 5);
});

test('more than ten missing pieces are not silently truncated; selecting a subset produces a valid draft', () => {
  const snapshot = published([
    garment('foreign-top', 'top', ['white']),
    ...Array.from({ length: 12 }, (_, index) =>
      garment('foreign-shoe-' + index, 'shoes', ['black']),
    ),
  ]);
  const own = [garment('own-top', 'top', ['white'])];
  const full = matchPublishedOutfit(snapshot, own);
  assert.equal(full.missingCount, 12);
  assert.equal(full.draft, null);
  assert.match(full.warnings.join(' '), /до 10/);
  const limited = matchPublishedOutfit(snapshot, own, { selectedIndexes: [0, 1, 2] });
  assert.equal(limited.canCreate, true);
  assert.equal(limited.draft.missingItems.length, 2);
  assert.equal(limited.selectedCount, 3);
});

test('empty or unavailable wardrobes produce no fake ready draft', () => {
  const snapshot = published([garment('foreign', 'top', ['white'])]);
  for (const items of [
    [],
    [garment('unavailable', 'top', ['white'], { available: false })],
    [garment('wrong', 'shoes', ['white'])],
  ]) {
    const result = matchPublishedOutfit(snapshot, items);
    assert.equal(result.canCreate, false);
    assert.equal(result.draft, null);
    assert.equal(result.matchedCount, 0);
    assert.ok(result.warnings.length);
  }
});

test('matching is deterministic independent of owned input order and excludes duplicate owned IDs', () => {
  const snapshot = published([
    garment('source-a', 'top', ['white']),
    garment('source-b', 'top', ['white']),
  ]);
  const a = garment('own-a', 'top', ['white']);
  const b = garment('own-b', 'top', ['white']);
  const first = matchPublishedOutfit(snapshot, [a, b, a]);
  const second = matchPublishedOutfit(snapshot, [b, a]);
  assert.deepEqual(first.draft.itemIds, second.draft.itemIds);
  assert.equal(first.draft.itemIds.length, 2);
});

test('draft defaults unknown public occasion/style/season safely and avoids missing-ID collisions', () => {
  const snapshot = {
    ...published([
      garment('foreign-a', 'top', ['white']),
      garment('foreign-b', 'shoes', ['black']),
    ]),
    occasion: 'custom occasion',
    style: 'custom style',
    season: 'custom season',
  };
  const result = matchPublishedOutfit(snapshot, [garment('inspired-missing-2', 'top', ['white'])]);
  assert.equal(result.draft.occasion, 'everyday');
  assert.equal(result.draft.style, '');
  assert.equal(result.draft.season, '');
  assert.notEqual(result.draft.missingItems[0].id, result.draft.itemIds[0]);
  assert.ok(result.warnings.some((warning) => /Повод/.test(warning)));
});

test('invalid source structures or selections fail clearly instead of generating malformed outfits', () => {
  assert.throws(() => matchPublishedOutfit({ items: [] }, []), /состава/);
  assert.throws(
    () => matchPublishedOutfit(published([garment('bad', 'fake', ['white'])]), []),
    /категория/,
  );
  assert.throws(
    () =>
      matchPublishedOutfit(published([garment('okay', 'top', ['white'])]), [], {
        selectedIndexes: [0, 0],
      }),
    /Выберите/,
  );
  assert.throws(
    () =>
      matchPublishedOutfit(published([garment('okay', 'top', ['white'])]), [], {
        selectedIndexes: [2],
      }),
    /Выберите/,
  );
});

test('maximum-size source and a full wardrobe keep every selected piece and produce a valid v5 outfit', () => {
  const state = demoState();
  const base = state.items.find((item) => item.category === 'top');
  state.items = Array.from({ length: 500 }, (_, index) => ({
    ...base,
    id: `own-${index}`,
    name: `Вещь ${index}`,
    colors: index % 2 ? ['blue'] : ['white'],
  }));
  state.outfits = [];
  state.plans = [];
  const snapshot = published(
    Array.from({ length: 30 }, (_, index) =>
      garment(`source-${index}`, 'top', index % 2 ? ['blue'] : ['white']),
    ),
  );
  const result = matchPublishedOutfit(snapshot, state.items);
  assert.equal(result.draft.itemIds.length, 30);
  assert.equal(new Set(result.draft.itemIds).size, 30);
  assert.equal(result.missingCount, 0);
  assert.equal(result.approximateCount, 0);
  putOutfit(state, result.draft);
  assert.equal(validateState(state).outfits[0].itemIds.length, 30);
});
