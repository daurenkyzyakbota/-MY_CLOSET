import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT_VERSION,
  MAX_ITEMS,
  emptyState,
  validateState,
  demoState,
  filterItems,
  outfitStatus,
  suggestItems,
  validDate,
  monthCells,
} from '../lib/data/model.js';
import { OCCASIONS, STYLE_OPTIONS, recommendOutfits } from '../lib/styling/stylist.js';

const CREATED = '2026-10-23T12:00:00.000Z';
const item = (id = 'shirt', category = 'top', changes = {}) => ({
  id,
  name: 'Белая базовая рубашка',
  category,
  colors: ['white'],
  seasons: ['spring', 'summer', 'autumn', 'winter'],
  size: 'M',
  style: 'Повседневный',
  favorite: false,
  available: true,
  photo: '',
  createdAt: CREATED,
  ...changes,
});
const outfit = () => ({
  id: 'look',
  name: 'Мой образ',
  itemIds: ['shirt'],
  favorite: true,
  createdAt: CREATED,
});
const legacy = () => ({
  version: 1,
  profile: { name: 'Амина', city: 'Кызылорда', styles: 'Минимализм', colors: ['white'] },
  items: [item()],
  outfits: [outfit()],
  plans: [{ id: 'plan', date: '2026-10-23', slot: 'day', outfitId: 'look' }],
});
const state = () => validateState(legacy());
const wardrobe = () => [
  item('top', 'top'),
  item('bottom', 'bottom', { name: 'Джинсы', colors: ['blue'] }),
  item('shoes', 'shoes', { name: 'Кеды' }),
];
const coldWeather = { feelsLike: 3, tempMin: 1, tempMax: 8, rainProbability: 0, windSpeed: 3 };
const warmWeather = { feelsLike: 22, tempMin: 19, tempMax: 25, rainProbability: 0, windSpeed: 2 };
const allWarnings = (result) =>
  [...result.warnings, ...result.outfits.flatMap((outfit) => outfit.warnings)].join(' ');

test('v1 migration preserves every personal record and returns an independent v2 copy', () => {
  const original = legacy();
  const copy = validateState(original);
  assert.equal(FORMAT_VERSION, 5);
  assert.equal(copy.version, 5);
  assert.equal(original.version, 1);
  assert.equal(copy.profile.name, original.profile.name);
  assert.equal(copy.profile.city, original.profile.city);
  assert.equal(copy.profile.location, null);
  assert.deepEqual(copy.items[0], {
    ...original.items[0],
    warmth: 'unknown',
    rainproof: 'unknown',
    subcategory: '',
    material: '',
    brand: '',
    notes: '',
    purchaseDate: '',
  });
  assert.deepEqual(copy.outfits[0], {
    ...original.outfits[0],
    occasion: 'everyday',
    style: '',
    season: '',
    description: '',
    missingItems: [],
  });
  assert.deepEqual(copy.plans, original.plans);
  copy.items[0].colors.push('black');
  assert.deepEqual(original.items[0].colors, ['white']);
});

test('corrupt or extended v1 is rejected before migration; defaults never hide invalid v2 values', () => {
  for (const mutate of [
    (s) => (s.items[0].warmth = 'warm'),
    (s) => (s.profile.location = null),
    (s) => delete s.items[0].name,
    (s) => (s.items[0].unknown = true),
  ]) {
    const candidate = legacy();
    mutate(candidate);
    assert.throws(() => validateState(candidate));
  }
  for (const [field, value] of [
    ['warmth', null],
    ['warmth', ['warm']],
    ['warmth', 'hot'],
    ['rainproof', false],
    ['rainproof', 'waterproof'],
  ]) {
    const candidate = state();
    candidate.items[0][field] = value;
    assert.throws(() => validateState(candidate));
  }
  const sparse = { ...legacy(), version: 2 };
  assert.equal(validateState(sparse).items[0].warmth, 'unknown');
  assert.equal(validateState(sparse).outfits[0].occasion, 'everyday');
});

test('v2 profile location and outfit details survive exact backup round trip', () => {
  const candidate = state();
  candidate.profile.location = {
    id: 1519928,
    name: 'Кызылорда',
    country: 'Казахстан',
    admin1: 'Кызылординская область',
    latitude: 44.8479,
    longitude: 65.4999,
    timezone: 'Asia/Qyzylorda',
  };
  Object.assign(candidate.outfits[0], {
    occasion: 'study',
    style: 'minimal',
    season: 'autumn',
    description: 'Спокойный комплект на учёбу',
  });
  Object.assign(candidate.items[0], { warmth: 'medium', rainproof: 'no' });
  assert.deepEqual(validateState(candidate), candidate);
  for (const mutate of [
    (s) => (s.profile.location.latitude = 91),
    (s) => (s.profile.location.longitude = '65'),
    (s) => (s.profile.location.timezone = 'Fake/Time'),
    (s) => (s.profile.location.id = -1),
    (s) => (s.profile.location.extra = true),
    (s) => (s.outfits[0].description = 'a'.repeat(501)),
    (s) => (s.outfits[0].occasion = 'graduation'),
    (s) => (s.outfits[0].season = ['winter']),
  ]) {
    const invalid = structuredClone(candidate);
    mutate(invalid);
    assert.throws(() => validateState(invalid));
  }
  candidate.profile.location.id = '1519928';
  assert.doesNotThrow(() => validateState(candidate));
  candidate.profile.location.timezone = null;
  assert.equal(validateState(candidate).profile.location.timezone, null);
});

test('legacy validation still rejects unknown schema, duplicate IDs, enum coercion and invalid dates', () => {
  const mutations = [
    (s) => (s.version = 6),
    (s) => (s.profile.colors = ['invisible']),
    (s) => (s.items[0].category = ['top']),
    (s) => (s.items[0].colors = [['white']]),
    (s) => (s.items[0].id = '../shirt'),
    (s) => s.items.push({ ...s.items[0] }),
    (s) => (s.items[0].favorite = 'false'),
    (s) => (s.items[0].seasons = []),
    (s) => (s.outfits[0].itemIds = ['shirt', 'shirt']),
    (s) => (s.outfits[0].itemIds = []),
    (s) => (s.plans[0].date = '2026-02-29'),
    (s) => (s.plans[0].outfitId = 'missing'),
    (s) => s.plans.push({ ...s.plans[0], id: 'second' }),
    (s) => (s.items[0].createdAt = '2026-02-30T12:00:00.000Z'),
  ];
  for (const mutate of mutations) {
    const candidate = state();
    mutate(candidate);
    assert.throws(() => validateState(candidate));
  }
  const candidate = state();
  candidate.plans.push({ ...candidate.plans[0], id: 'evening', slot: 'evening' });
  assert.doesNotThrow(() => validateState(candidate));
});

test('photo types and size and collection limits remain enforced', () => {
  const candidate = state();
  for (const photo of [
    'https://example.com/a.png',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,<bad>',
  ]) {
    candidate.items[0].photo = photo;
    assert.throws(() => validateState(candidate));
  }
  candidate.items[0].photo = 'data:image/png;base64,iVBORw0KGgo=';
  assert.doesNotThrow(() => validateState(candidate));
  candidate.items[0].photo = 'a'.repeat(4000001);
  assert.throws(() => validateState(candidate));
  candidate.items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item(`item${i}`));
  assert.throws(() => validateState(candidate));
  candidate.items = Array.from({ length: 13 }, (_, i) =>
    item(`item${i}`, 'top', { photo: 'data:image/png;base64,' + 'A'.repeat(3900000) }),
  );
  assert.throws(() => validateState(candidate), /50 МБ/);
});

test('deleted garment references remain visible instead of silently altering saved outfits', () => {
  const candidate = state();
  candidate.items = [];
  assert.doesNotThrow(() => validateState(candidate));
  assert.deepEqual(outfitStatus(candidate.outfits[0], candidate.items), {
    missing: ['shirt'],
    unavailable: [],
    complete: false,
    items: [],
  });
  assert.deepEqual(
    outfitStatus(outfit(), [item('shirt', 'top', { available: false })]).unavailable,
    ['shirt'],
  );
});

test('existing helpers and demo data stay compatible', () => {
  const demo = demoState();
  assert.equal(demo.version, 5);
  assert.equal(demo.items.length, 6);
  assert.equal(demo.outfits.length, 1);
  assert.doesNotThrow(() => validateState(demo));
  const withUser = demoState(state());
  assert.equal(withUser.items[0].id, 'shirt');
  assert.equal(withUser.plans.length, 1);
  assert.equal(withUser.profile.name, 'Амина');
  assert.deepEqual(
    filterItems([item('yes', 'top', { favorite: true }), item('no', 'top', { available: false })], {
      query: 'БЕЛАЯ',
      favorites: true,
      availability: 'available',
    }).map((x) => x.id),
    ['yes'],
  );
  assert.equal(suggestItems(wardrobe(), 'summer').length, 3);
  assert.deepEqual(suggestItems(wardrobe().filter((x) => x.category !== 'shoes')), []);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2100-02-29'), false);
  assert.deepEqual(monthCells(2026, 0).slice(0, 4), [null, null, null, '2026-01-01']);
});

test('stylist requires an owned complete base plus shoes, and never invents items', () => {
  const items = wardrobe();
  const result = recommendOutfits(items);
  assert.equal(result.outfits.length, 1);
  assert.equal(result.outfits[0].complete, true);
  assert.deepEqual(new Set(result.outfits[0].itemIds), new Set(items.map((x) => x.id)));
  const missingShoes = recommendOutfits(items.filter((x) => x.category !== 'shoes'));
  assert.equal(missingShoes.outfits.length, 0);
  assert.deepEqual(missingShoes.missingCategories, ['shoes']);
  const missingBase = recommendOutfits(items.filter((x) => x.category !== 'bottom'));
  assert.equal(missingBase.outfits.length, 0);
  assert.ok(missingBase.missingCategories.includes('bottom'));
  const dress = recommendOutfits([item('dress', 'dress'), item('shoe', 'shoes')]);
  assert.deepEqual(new Set(dress.outfits[0].itemIds), new Set(['dress', 'shoe']));
});

test('strict season and laundry exclusions apply to all returned items', () => {
  const items = [
    ...wardrobe(),
    item('dress', 'dress', { seasons: ['winter'] }),
    item('dirty', 'top', { available: false }),
  ];
  for (const look of recommendOutfits(items, { season: 'summer' }).outfits) {
    assert.ok(!look.itemIds.includes('dirty'));
    assert.ok(!look.itemIds.includes('dress'));
  }
  assert.equal(
    recommendOutfits([item('dress', 'dress', { seasons: ['winter'] }), item('shoe', 'shoes')], {
      season: 'summer',
    }).outfits.length,
    0,
  );
});

test('returns up to three distinct full outfits with a preserved anchor', () => {
  const items = [
    ...wardrobe(),
    item('top2', 'top'),
    item('bottom2', 'bottom'),
    item('dress', 'dress'),
    item('bag', 'accessory'),
  ];
  for (const anchorItemId of ['top', 'bottom', 'dress', 'shoes', 'bag']) {
    const result = recommendOutfits(items, { anchorItemId, limit: 3 });
    assert.ok(result.outfits.length >= 1);
    assert.ok(result.outfits.length <= 3);
    assert.ok(result.outfits.every((x) => x.itemIds.includes(anchorItemId)));
    const signatures = result.outfits.map((x) => x.itemIds.slice().sort().join(','));
    assert.equal(new Set(signatures).size, signatures.length);
    for (const look of result.outfits) {
      const categories = look.itemIds.map((id) => items.find((x) => x.id === id).category);
      assert.ok(categories.includes('shoes'));
      assert.ok(
        categories.includes('dress') ||
          (categories.includes('top') && categories.includes('bottom')),
      );
    }
  }
});

test('unusable anchors are explained and never dropped silently', () => {
  const items = [
    ...wardrobe(),
    item('dirty', 'top', { available: false }),
    item('winter', 'top', { seasons: ['winter'] }),
    item('coat', 'outerwear', { warmth: 'warm' }),
  ];
  for (const options of [
    { anchorItemId: 'missing' },
    { anchorItemId: 'dirty' },
    { anchorItemId: 'winter', season: 'summer' },
    { anchorItemId: 'coat', weather: { ...warmWeather, feelsLike: 30 } },
  ]) {
    const result = recommendOutfits(items, options);
    assert.equal(result.outfits.length, 0);
    assert.ok(result.warnings.length > 0);
  }
});

test('cold weather requires a coat and rejects explicitly light cold-weather garments', () => {
  const items = wardrobe();
  const noCoat = recommendOutfits(items, { weather: coldWeather });
  assert.equal(noCoat.outfits.length, 0);
  assert.ok(noCoat.missingCategories.includes('outerwear'));
  const withCoat = [...items, item('coat', 'outerwear', { warmth: 'warm', rainproof: 'yes' })];
  const result = recommendOutfits(withCoat, { weather: coldWeather });
  assert.ok(result.outfits.length);
  assert.ok(result.outfits.every((x) => x.itemIds.includes('coat')));
  const thin = withCoat.map((x) => (x.category === 'bottom' ? { ...x, warmth: 'light' } : x));
  assert.equal(recommendOutfits(thin, { weather: coldWeather }).outfits.length, 0);
  const mediumCoat = withCoat.map((x) => (x.id === 'coat' ? { ...x, warmth: 'medium' } : x));
  assert.equal(
    recommendOutfits(mediumCoat, { weather: { ...coldWeather, feelsLike: -5 } }).outfits.length,
    0,
  );
});

test('unknown clothing metadata is never claimed as weather protection', () => {
  const result = recommendOutfits([...wardrobe(), item('coat', 'outerwear')], {
    weather: coldWeather,
  });
  assert.ok(result.outfits.length);
  const warning = allWarnings(result);
  assert.match(warning, /Теплота/);
  assert.match(warning, /дождя не указана/);
  assert.match(warning, /может быть холодно/);
  assert.match(allWarnings(recommendOutfits(wardrobe())), /Погода не выбрана/);
});

test('heat excludes outer layers and explicitly warm garments, including anchors', () => {
  const items = [
    ...wardrobe(),
    item('coat', 'outerwear', { warmth: 'warm' }),
    item('sweater', 'top', { warmth: 'warm' }),
  ];
  const result = recommendOutfits(items, { weather: { ...warmWeather, feelsLike: 29 } });
  assert.ok(result.outfits.length);
  assert.ok(
    result.outfits.every((x) => !x.itemIds.includes('coat') && !x.itemIds.includes('sweater')),
  );
  const noBase = recommendOutfits(
    items.filter((x) => x.id !== 'top'),
    { weather: { ...warmWeather, feelsLike: 29 } },
  );
  assert.equal(noBase.outfits.length, 0);
});

test('rain prefers declared protection, rejects declared non-protection, warns on unknowns and wind', () => {
  const weather = { ...coldWeather, rainProbability: 85, windSpeed: 14 };
  const items = [
    ...wardrobe().filter((x) => x.category !== 'shoes'),
    item('dry', 'shoes', { rainproof: 'no' }),
    item('protected', 'shoes', { rainproof: 'yes' }),
    item('unknown', 'shoes'),
    item('coat', 'outerwear', { warmth: 'warm', rainproof: 'yes' }),
  ];
  const result = recommendOutfits(items, { weather });
  assert.ok(result.outfits.length);
  assert.ok(result.outfits.every((x) => !x.itemIds.includes('dry')));
  assert.ok(result.outfits[0].itemIds.includes('protected'));
  assert.match(result.warnings.join(' '), /Сильный ветер/);
  const unknown = result.outfits.find((x) => x.itemIds.includes('unknown'));
  assert.match(unknown.warnings.join(' '), /дождя не указана/);
  const none = recommendOutfits(
    items.filter((x) => !['protected', 'unknown'].includes(x.id)),
    { weather },
  );
  assert.equal(none.outfits.length, 0);
  assert.ok(none.missingCategories.includes('shoes'));
});

test('missing weather fields do not become a fabricated forecast', () => {
  const result = recommendOutfits(wardrobe(), { weather: { rainProbability: 0, windSpeed: 0 } });
  assert.ok(result.outfits.length);
  assert.match(result.warnings.join(' '), /температура не указана/);
  assert.ok(!result.outfits[0].itemIds.some((id) => id === 'coat'));
  assert.match(
    allWarnings(
      recommendOutfits(wardrobe(), {
        weather: { feelsLike: NaN, rainProbability: 200, windSpeed: -1 },
      }),
    ),
    /не указана/,
  );
});

test('occasion and free-text Russian style rank useful items with honest explanations', () => {
  assert.equal(Object.keys(OCCASIONS).length, 8);
  assert.equal(STYLE_OPTIONS.comfortable, 'Комфортно');
  const items = [
    item('sport', 'top', { name: 'Худи спортивное', style: 'Спортивный' }),
    item('office', 'top', { name: 'Офисная рубашка', style: 'Классический' }),
    item('bottom', 'bottom', { name: 'Прямые брюки', style: 'Классический' }),
    item('shoes', 'shoes', { name: 'Лоферы', style: 'Классический' }),
  ];
  const result = recommendOutfits(items, {
    occasion: 'work',
    style: 'classic',
    weather: warmWeather,
  });
  assert.ok(result.outfits[0].itemIds.includes('office'));
  assert.match(result.outfits[0].reasons.join(' '), /приблизительное/);
  assert.match(allWarnings(result), /дресс-код/);
  const unknown = recommendOutfits(
    wardrobe().map((x) => ({ ...x, name: 'Вещь', style: '' })),
    { occasion: 'formal', style: 'elegant' },
  );
  assert.match(allWarnings(unknown), /не указан/);
  assert.match(allWarnings(unknown), /не подтверждено/);
});

test('palette favors one accent over arbitrary strong colors and repeat requests return alternatives', () => {
  const items = [
    item('white', 'top', { colors: ['white'] }),
    item('red', 'top', { colors: ['red'] }),
    item('blue', 'bottom', { colors: ['blue'] }),
    item('black', 'shoes', { colors: ['black'] }),
  ];
  const first = recommendOutfits(items, { limit: 1 });
  assert.ok(first.outfits[0].itemIds.includes('white'));
  const second = recommendOutfits(items, { limit: 1, variant: 1 });
  assert.notDeepEqual(first.outfits[0].itemIds, second.outfits[0].itemIds);
  assert.match(allWarnings(second), /контрастных цветов/);
});
