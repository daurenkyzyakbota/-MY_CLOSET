import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT_VERSION,
  emptyState,
  validateState,
  demoState,
  WEAR_ITEM_LIMIT,
  MAX_WEAR_RECORDS,
  MAX_WEAR_REFERENCES,
  MAX_CAPSULES,
  MAX_TRIPS,
} from '../lib/data/model.js';
import {
  markWorn,
  removeWear,
  saveCapsule,
  removeCapsule,
  saveTrip,
  removeTrip,
  toggleTripPacked,
  getWearStatistics,
} from '../lib/data/wardrobe-life.js';
import { createClosetController } from '../lib/data/closet-state.js';

const CREATED = '2026-10-30T12:00:00.000Z';
const garment = (id, changes = {}) => ({
  id,
  name: id,
  category: 'top',
  colors: ['white'],
  seasons: ['summer'],
  size: '',
  style: '',
  favorite: false,
  available: true,
  photo: '',
  createdAt: CREATED,
  ...changes,
});
function fixture() {
  return validateState({
    ...emptyState(),
    profile: { ...emptyState().profile, name: 'Бота', styles: 'Мой стиль' },
    items: [
      garment('shirt', {
        name: 'Рубашка',
        photo: 'data:image/png;base64,iVBORw0KGgo=',
        brand: 'Мой бренд',
      }),
      garment('jeans', { name: 'Джинсы', category: 'bottom' }),
      garment('sneakers', { name: 'Кеды', category: 'shoes' }),
    ],
    outfits: [
      {
        id: 'look',
        name: 'Мой образ',
        itemIds: ['shirt', 'jeans', 'sneakers'],
        favorite: true,
        createdAt: CREATED,
      },
    ],
    plans: [{ id: 'plan', date: '2026-10-30', slot: 'day', outfitId: 'look' }],
    shoppingList: [
      {
        id: 'wish',
        name: 'Шарф',
        category: 'accessory',
        colors: [],
        season: '',
        style: '',
        size: '',
        budget: 0,
        notes: 'Подарок',
        status: 'planned',
        itemId: '',
        createdAt: CREATED,
      },
    ],
  });
}
function legacy(version) {
  const state = fixture();
  state.version = version;
  for (const key of ['wearLog', 'capsules', 'trips']) delete state[key];
  if (version < 4)
    for (const item of state.items)
      for (const key of ['subcategory', 'material', 'brand', 'notes', 'purchaseDate'])
        delete item[key];
  if (version < 3) {
    delete state.shoppingList;
    for (const outfit of state.outfits) delete outfit.missingItems;
  }
  if (version === 1) {
    delete state.profile.location;
    for (const item of state.items) {
      delete item.warmth;
      delete item.rainproof;
    }
    for (const outfit of state.outfits)
      for (const key of ['occasion', 'style', 'season', 'description']) delete outfit[key];
  }
  return state;
}
const wear = (changes = {}) => ({
  id: 'wear',
  date: '2026-10-29',
  itemIds: ['shirt'],
  outfitId: '',
  notes: '',
  ...changes,
});
const capsule = (changes = {}) => ({
  id: 'capsule',
  name: 'Осенняя капсула',
  description: '',
  itemIds: ['shirt'],
  outfitIds: ['look'],
  createdAt: CREATED,
  ...changes,
});
const trip = (changes = {}) => ({
  id: 'trip',
  name: 'На выходные',
  destination: 'Алматы',
  startDate: '2026-10-30',
  endDate: '2026-11-02',
  itemIds: ['shirt'],
  outfitIds: ['look'],
  packedItemIds: [],
  notes: '',
  createdAt: CREATED,
  ...changes,
});

test('strict v1–v4 migration preserves each old record and adds independent empty v5 collections', () => {
  assert.equal(FORMAT_VERSION, 5);
  for (const version of [1, 2, 3, 4]) {
    const original = legacy(version);
    const before = structuredClone(original);
    const migrated = validateState(original);
    assert.equal(migrated.version, 5);
    for (const key of ['wearLog', 'capsules', 'trips']) assert.deepEqual(migrated[key], []);
    assert.equal(migrated.items[0].id, original.items[0].id);
    assert.equal(migrated.items[0].photo, original.items[0].photo);
    assert.deepEqual(migrated.plans, original.plans);
    assert.equal(migrated.outfits[0].favorite, true);
    if (version >= 3) assert.deepEqual(migrated.shoppingList, original.shoppingList);
    if (version === 4) assert.equal(migrated.items[0].brand, 'Мой бренд');
    assert.deepEqual(original, before);
    assert.deepEqual(validateState(migrated), migrated);
  }
});

test('old versions reject v5 fields before migration, and v5 requires every collection', () => {
  for (const version of [1, 2, 3, 4])
    for (const key of ['wearLog', 'capsules', 'trips']) {
      const state = legacy(version);
      state[key] = [];
      assert.throws(() => validateState(state), /неизвестное поле/);
    }
  for (const key of ['wearLog', 'capsules', 'trips']) {
    const state = fixture();
    delete state[key];
    assert.throws(() => validateState(state), /отсутствует поле/);
  }
  const corrupt = legacy(4);
  corrupt.items[0].brand = null;
  assert.throws(() => validateState(corrupt), /Бренд/);
});

test('v5 backup round trip preserves all life records and dangling references independently', () => {
  const state = fixture();
  state.wearLog = [
    wear({ itemIds: ['deleted-shirt'], outfitId: 'deleted-look', date: '2200-12-31' }),
  ];
  state.capsules = [capsule({ itemIds: ['deleted-shirt'], outfitIds: ['deleted-look'] })];
  state.trips = [
    trip({
      itemIds: ['deleted-shirt'],
      outfitIds: ['deleted-look'],
      packedItemIds: ['deleted-shirt'],
    }),
  ];
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  restored.trips[0].packedItemIds.length = 0;
  assert.deepEqual(state.trips[0].packedItemIds, ['deleted-shirt']);
});

test('wear validation rejects wrong shape, IDs, duplicates, real dates, text and per-event limits', () => {
  const mutations = [
    (entry) => (entry.id = '../bad'),
    (entry) => (entry.extra = true),
    (entry) => delete entry.notes,
    (entry) => (entry.date = '2026-02-29'),
    (entry) => (entry.date = '2026-2-01'),
    (entry) => (entry.itemIds = []),
    (entry) => (entry.itemIds = ['shirt', 'shirt']),
    (entry) => (entry.itemIds = ['../bad']),
    (entry) => (entry.itemIds = 'shirt'),
    (entry) =>
      (entry.itemIds = Array.from({ length: WEAR_ITEM_LIMIT + 1 }, (_, index) => `item${index}`)),
    (entry) => (entry.outfitId = null),
    (entry) => (entry.outfitId = '../bad'),
    (entry) => (entry.notes = 'я'.repeat(501)),
    (entry) => (entry.notes = false),
  ];
  for (const mutate of mutations) {
    const state = fixture();
    const entry = wear();
    mutate(entry);
    state.wearLog = [entry];
    assert.throws(() => validateState(state));
  }
  const state = fixture();
  state.wearLog = [wear({ date: '2024-02-29', notes: 'я'.repeat(500) })];
  assert.doesNotThrow(() => validateState(state));
  state.wearLog.push(wear({ id: 'second' }));
  state.wearLog.push(wear({ id: 'third' }));
  assert.throws(() => validateState(state), /уже отмечены/);
});

test('history limits bound both number of records and total references', () => {
  const state = emptyState();
  const ids = Array.from({ length: WEAR_ITEM_LIMIT }, (_, index) => `garment${index}`);
  state.wearLog = Array.from({ length: MAX_WEAR_RECORDS }, (_, index) =>
    wear({
      id: `wear${index}`,
      outfitId: `look${index}`,
      itemIds: ids.slice(0, MAX_WEAR_REFERENCES / MAX_WEAR_RECORDS),
    }),
  );
  assert.doesNotThrow(() => validateState(state));
  state.wearLog[0].itemIds.push('one-more');
  assert.throws(() => validateState(state), /100000/);
  state.wearLog = Array.from({ length: MAX_WEAR_RECORDS + 1 }, (_, index) =>
    wear({ id: `wear${index}`, outfitId: `look${index}` }),
  );
  assert.throws(() => validateState(state), /5000/);
});

test('capsule validation checks required name, text, unique bounded references and dates', () => {
  const mutations = [
    (entry) => (entry.name = ' '),
    (entry) => (entry.name = 'я'.repeat(101)),
    (entry) => (entry.description = 'я'.repeat(1001)),
    (entry) => (entry.description = null),
    (entry) => (entry.itemIds = ['shirt', 'shirt']),
    (entry) => (entry.itemIds = ['../bad']),
    (entry) => (entry.outfitIds = ['look', 'look']),
    (entry) => (entry.outfitIds = Array.from({ length: 501 }, (_, index) => `look${index}`)),
    (entry) => (entry.createdAt = '2026-02-30T00:00:00.000Z'),
    (entry) => (entry.surprise = true),
  ];
  for (const mutate of mutations) {
    const state = fixture();
    const entry = capsule();
    mutate(entry);
    state.capsules = [entry];
    assert.throws(() => validateState(state));
  }
  const state = fixture();
  state.capsules = [capsule({ description: 'я'.repeat(1000), itemIds: [], outfitIds: [] })];
  assert.doesNotThrow(() => validateState(state));
  state.capsules = Array.from({ length: MAX_CAPSULES + 1 }, (_, index) =>
    capsule({ id: `capsule${index}` }),
  );
  assert.throws(() => validateState(state), /100/);
});

test('trip validation checks real ordered bounded dates and packed subset, including leap dates', () => {
  const mutations = [
    (entry) => (entry.name = ''),
    (entry) => (entry.name = 'я'.repeat(101)),
    (entry) => (entry.destination = 'я'.repeat(121)),
    (entry) => (entry.notes = 'я'.repeat(1001)),
    (entry) => (entry.startDate = ''),
    (entry) => (entry.startDate = '2026-02-29'),
    (entry) => (entry.endDate = '2026-10-29'),
    (entry) => (entry.endDate = '2027-10-31'),
    (entry) => (entry.packedItemIds = ['not-selected']),
    (entry) => (entry.packedItemIds = ['shirt', 'shirt']),
    (entry) => (entry.itemIds = ['../bad']),
    (entry) => (entry.outfitIds = 'look'),
    (entry) => (entry.createdAt = null),
    (entry) => (entry.extra = true),
  ];
  for (const mutate of mutations) {
    const state = fixture();
    const entry = trip();
    mutate(entry);
    state.trips = [entry];
    assert.throws(() => validateState(state));
  }
  const state = fixture();
  state.trips = [
    trip({
      startDate: '2024-02-29',
      endDate: '2024-02-29',
      notes: 'я'.repeat(1000),
      packedItemIds: ['shirt'],
    }),
  ];
  assert.doesNotThrow(() => validateState(state));
  state.trips[0].endDate = '2025-02-28';
  assert.doesNotThrow(() => validateState(state));
  state.trips = Array.from({ length: MAX_TRIPS + 1 }, (_, index) => trip({ id: `trip${index}` }));
  assert.throws(() => validateState(state), /100/);
});

test('markWorn derives a real outfit and blocks repeated same-day composition regardless of order', () => {
  const state = fixture();
  const entry = markWorn(state, { date: '2026-10-29', outfitId: 'look', notes: 'Встреча' });
  assert.deepEqual(entry.itemIds, state.outfits[0].itemIds);
  assert.notEqual(entry.itemIds, state.outfits[0].itemIds);
  assert.equal(entry.notes, 'Встреча');
  const before = structuredClone(state);
  assert.throws(
    () =>
      markWorn(state, {
        date: entry.date,
        outfitId: 'look',
        itemIds: [...entry.itemIds].reverse(),
      }),
    /уже отмечены/,
  );
  assert.deepEqual(state, before);
  markWorn(state, { date: '2026-10-30', outfitId: 'look' });
  markWorn(state, { date: '2026-10-29', itemIds: ['shirt'] });
  assert.equal(state.wearLog.length, 3);
});

test('new wear rejects laundry, missing garments and incomplete saved outfits without mutating the draft', () => {
  for (const scenario of ['laundry', 'missing', 'partial', 'deleted-outfit']) {
    const state = fixture();
    if (scenario === 'laundry') state.items[0].available = false;
    if (scenario === 'missing') state.items.shift();
    if (scenario === 'partial')
      state.outfits[0].missingItems = [
        {
          id: 'missing',
          name: 'Шарф',
          category: 'accessory',
          colors: [],
          season: '',
          style: '',
          size: '',
          reason: '',
        },
      ];
    if (scenario === 'deleted-outfit') state.outfits = [];
    const before = structuredClone(state);
    assert.throws(() => markWorn(state, { date: '2026-10-30', outfitId: 'look' }));
    assert.deepEqual(state, before);
  }
  const state = fixture();
  state.items[0].available = false;
  const before = structuredClone(state);
  assert.throws(() => markWorn(state, { itemIds: ['shirt'] }), /стирке/);
  assert.throws(() => markWorn(state, { itemIds: ['missing'] }), /не найдена/);
  assert.deepEqual(state, before);
});

test('capsule edits preserve identity and creation time; failed saves leave every collection intact', () => {
  const state = fixture();
  const original = saveCapsule(state, {
    name: 'Моя капсула',
    itemIds: ['shirt'],
    outfitIds: ['look'],
    createdAt: CREATED,
  });
  const changed = saveCapsule(state, {
    id: original.id,
    name: 'Обновлённая капсула',
    createdAt: '2020-01-01T00:00:00.000Z',
  });
  assert.equal(state.capsules.length, 1);
  assert.equal(changed.createdAt, CREATED);
  assert.deepEqual(changed.itemIds, ['shirt']);
  const before = structuredClone(state);
  assert.throws(() => saveCapsule(state, { id: original.id, name: '' }));
  assert.deepEqual(state, before);
  assert.equal(removeCapsule(state, original.id).name, 'Обновлённая капсула');
  assert.equal(removeCapsule(state, 'missing'), null);
  assert.equal(state.items.length, 3);
});

test('packing toggles only selected current garments and preserves trip metadata and unrelated state', () => {
  const state = fixture();
  saveTrip(state, trip());
  const packed = toggleTripPacked(state, 'trip', 'shirt');
  assert.deepEqual(packed.packedItemIds, ['shirt']);
  assert.equal(packed.createdAt, CREATED);
  assert.equal(packed.destination, 'Алматы');
  const before = structuredClone(state);
  assert.throws(() => toggleTripPacked(state, 'trip', 'jeans'), /не входит/);
  assert.throws(() => toggleTripPacked(state, 'missing', 'shirt'), /не найдена/);
  assert.deepEqual(state, before);
  state.items = state.items.filter((item) => item.id !== 'shirt');
  assert.deepEqual(toggleTripPacked(state, 'trip', 'shirt').packedItemIds, []);
  assert.throws(() => toggleTripPacked(state, 'trip', 'shirt'), /Удалённую/);
  assert.deepEqual(state.trips[0].itemIds, ['shirt']);
  assert.equal(removeTrip(state, 'trip').id, 'trip');
  assert.equal(removeTrip(state, 'trip'), null);
  assert.equal(state.outfits.length, 1);
});

test('removing garments or outfits never erases wear history, capsules or trip references', () => {
  const state = fixture();
  const entry = markWorn(state, { date: '2026-10-29', outfitId: 'look' });
  saveCapsule(state, capsule());
  saveTrip(state, trip({ packedItemIds: ['shirt'] }));
  const retained = structuredClone({
    wearLog: state.wearLog,
    capsules: state.capsules,
    trips: state.trips,
  });
  state.items = [];
  state.outfits = [];
  state.plans = [];
  const restored = validateState(state);
  assert.deepEqual(
    { wearLog: restored.wearLog, capsules: restored.capsules, trips: restored.trips },
    retained,
  );
  assert.equal(removeWear(state, entry.id).id, entry.id);
  assert.equal(removeWear(state, entry.id), null);
  assert.equal(state.capsules.length, 1);
  assert.equal(state.trips.length, 1);
});

test('wear statistics count actual events, keep never-worn items and ignore future dates as of the requested day', () => {
  const state = fixture();
  markWorn(state, { date: '2024-02-28', itemIds: ['shirt', 'jeans'] });
  markWorn(state, { date: '2024-02-29', itemIds: ['shirt'] });
  markWorn(state, { date: '2024-03-02', itemIds: ['sneakers'] });
  state.wearLog.push(
    wear({ id: 'deleted-history', itemIds: ['deleted-garment'], date: '2024-02-29' }),
  );
  const before = structuredClone(state);
  const stats = getWearStatistics(state, '2024-03-01');
  assert.equal(stats.totalWears, 3);
  assert.equal(stats.neverWornCount, 1);
  const shirt = stats.items.find((row) => row.id === 'shirt');
  assert.equal(shirt.item, state.items[0]);
  assert.equal(shirt.wearCount, 2);
  assert.equal(shirt.lastWorn, '2024-02-29');
  assert.equal(shirt.daysSinceLastWorn, 1);
  assert.equal(stats.items.find((row) => row.id === 'jeans').daysSinceLastWorn, 2);
  const sneakers = stats.items.find((row) => row.id === 'sneakers');
  assert.equal(sneakers.wearCount, 0);
  assert.equal(sneakers.lastWorn, null);
  assert.equal(sneakers.daysSinceLastWorn, null);
  assert.deepEqual(
    stats.mostWorn.map((row) => row.id),
    ['shirt', 'jeans'],
  );
  assert.deepEqual(state, before);
  assert.throws(() => getWearStatistics(state, '2026-02-29'), /корректную дату/);
});

test('demo addition preserves new personal collections alongside old data', () => {
  const state = fixture();
  markWorn(state, { date: '2026-10-29', itemIds: ['shirt'] });
  saveCapsule(state, capsule());
  saveTrip(state, trip());
  const before = structuredClone(state);
  const result = demoState(state);
  for (const key of ['wearLog', 'capsules', 'trips', 'shoppingList', 'plans'])
    assert.deepEqual(result[key], before[key]);
  assert.equal(result.items.length, 9);
  assert.deepEqual(state, before);
});

test('new life operations remain serialized, persist before publish and reject concurrent duplicate wear', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const writes = [];
  const controller = createClosetController({
    load: async () => fixture(),
    save: async (state) => {
      writes.push(structuredClone(state));
      if (writes.length === 1) await gate;
    },
  });
  await controller.initialize();
  const first = controller.update((state) => {
    markWorn(state, { date: '2026-10-30', itemIds: ['shirt'] });
  });
  const duplicate = controller.update((state) => {
    markWorn(state, { date: '2026-10-30', itemIds: ['shirt'] });
  });
  const rejectDuplicate = assert.rejects(duplicate, /уже отмечены/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.snapshot().state.wearLog.length, 0);
  assert.equal(writes.length, 1);
  release();
  await first;
  await rejectDuplicate;
  assert.equal(controller.snapshot().state.wearLog.length, 1);
  assert.equal(writes.length, 1);
  await controller.update((state) => {
    saveCapsule(state, capsule());
    saveTrip(state, trip());
  });
  const persisted = writes.at(-1);
  assert.deepEqual(persisted, controller.snapshot().state);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(persisted))), persisted);
});

test('a failed life write leaves the published history unchanged and does not poison later writes', async () => {
  let fail = true;
  const controller = createClosetController({
    load: async () => fixture(),
    save: async () => {
      if (fail) throw new Error('Disk full');
    },
  });
  await controller.initialize();
  await assert.rejects(
    controller.update((state) => {
      markWorn(state, { date: '2026-10-30', itemIds: ['shirt'] });
    }),
    /Disk full/,
  );
  assert.deepEqual(controller.snapshot().state.wearLog, []);
  fail = false;
  await controller.update((state) => {
    markWorn(state, { date: '2026-10-30', itemIds: ['shirt'] });
  });
  assert.equal(controller.snapshot().state.wearLog.length, 1);
});
