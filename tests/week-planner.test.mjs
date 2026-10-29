import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekSuggestions, weekDates } from '../lib/week-planner.js';

const piece = (id, category, extra = {}) => ({ id, name: id, category, available: true, colors: ['black'], style: 'casual', seasons: ['spring', 'summer', 'autumn', 'winter'], warmth: 'medium', rainproof: 'yes', ...extra });
const items = [piece('top', 'top'), piece('bottom', 'bottom'), piece('shoes', 'shoes')];
const options = { items, startDate: '2026-10-30', today: '2026-10-30', weatherMode: 'none' };

test('seven local calendar dates cross months, leap years and the year boundary without shifting', () => {
  assert.deepEqual(weekDates('2024-02-27'), ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04']);
  assert.deepEqual(weekDates('2026-12-29').slice(-3), ['2027-01-02', '2027-01-03', '2027-01-04']);
  assert.equal(weekDates('2200-12-25').at(-1), '2200-12-31');
  for (const date of ['', '2026-02-30', '1899-12-31', '2200-12-26']) assert.throws(() => weekDates(date));
});

test('occupied slots are protected while a plan at the other time remains independent', () => {
  const existing = { id: 'saved-plan', date: '2026-10-31', slot: 'day', outfitId: 'old-outfit' };
  const plans = [existing, { id: 'evening', date: '2026-11-01', slot: 'evening', outfitId: 'old-outfit' }];
  const before = structuredClone(plans);
  const result = buildWeekSuggestions({ ...options, plans });
  assert.equal(result.proposals.length, 6);
  assert.equal(result.days[1].status, 'occupied');
  assert.equal(result.days[1].existingPlan.id, existing.id);
  assert.equal(result.days[2].status, 'suggested');
  assert.ok(result.proposals.every(value => value.date !== existing.date));
  assert.deepEqual(plans, before);
  assert.equal(buildWeekSuggestions({ ...options, plans, slot: 'evening' }).days[1].status, 'suggested');
});

test('only owned available pieces enter suggestions, including when unavailable options look preferable', () => {
  const pool = [...items, piece('unavailable-favorite', 'top', { available: false, favorite: true }), piece('laundry-shoes', 'shoes', { available: false })];
  const result = buildWeekSuggestions({ ...options, items: pool });
  assert.equal(result.proposals.length, 7);
  for (const proposal of result.proposals) assert.deepEqual([...proposal.outfit.itemIds].sort(), ['bottom', 'shoes', 'top']);
  assert.equal(buildWeekSuggestions({ ...options, items: pool.filter(item => item.id !== 'shoes') }).proposals.length, 0);
});

test('real date-specific weather can prevent an unsafe cold suggestion and absent forecasts stay unknown', () => {
  const forecast = { current: { dateTime: '2026-10-30T12:00', feelsLike: 20 }, days: [{ date: '2026-10-30', feelsMin: 2, tempMin: 3, tempMax: 20, rainProbability: 0, windSpeed: 2 }, { date: '2026-10-31', feelsMin: 3, tempMin: 4, tempMax: 10, rainProbability: 30, windSpeed: 2 }] };
  const result = buildWeekSuggestions({ ...options, weatherMode: 'auto', forecast });
  assert.equal(result.days[0].status, 'suggested');
  assert.equal(result.days[0].weather.feelsLike, 20);
  assert.equal(result.days[1].status, 'unavailable');
  assert.match(result.days[1].reason, /верхней одежды/);
  assert.equal(result.days[2].weather, null);
  assert.match(result.days[2].weatherNote, /нет прогноза/);
  assert.ok(result.warnings.some(value => value.includes('прогноз недоступен')));
  const warm = buildWeekSuggestions({ ...options, items: [...items, piece('coat', 'outerwear', { warmth: 'warm' })], weatherMode: 'auto', forecast });
  assert.equal(warm.days[1].status, 'suggested');
  assert.ok(warm.days[1].proposal.outfit.itemIds.includes('coat'));
});

test('diversity is a soft preference and an insufficient wardrobe produces honest repeat warnings', () => {
  const pool = [...items, piece('top2', 'top'), piece('bottom2', 'bottom')];
  const result = buildWeekSuggestions({ ...options, items: pool });
  const key = proposal => [...proposal.outfit.itemIds].sort().join('|');
  assert.notEqual(key(result.proposals[0]), key(result.proposals[1]));
  assert.equal(new Set(result.proposals.slice(0, 4).map(key)).size, 4);
  assert.ok(result.uniqueOutfits < result.proposals.length);
  assert.ok(result.warnings.some(value => value.includes('повторяются')));
  const single = buildWeekSuggestions(options);
  assert.equal(single.uniqueOutfits, 1);
  assert.match(single.days[1].explanation, /Повторяем/);
  assert.deepEqual(buildWeekSuggestions({ ...options, items: pool }), result);
});

test('reuse is restricted to complete saved outfits with the requested metadata', () => {
  const saved = { id: 'saved', name: 'Мой комплект', itemIds: ['bottom', 'top', 'shoes'], occasion: 'everyday', style: '', season: '', missingItems: [] };
  const result = buildWeekSuggestions({ ...options, outfits: [saved] });
  assert.equal(result.proposals[0].outfitId, saved.id);
  assert.equal(result.proposals[0].outfit.name, saved.name);
  assert.equal(buildWeekSuggestions({ ...options, outfits: [{ ...saved, occasion: 'work' }] }).proposals[0].outfitId, '');
  assert.equal(buildWeekSuggestions({ ...options, outfits: [{ ...saved, missingItems: [{ name: 'Нужна сумка' }] }] }).proposals[0].outfitId, '');
});

test('empty wardrobes and full calendars never create placeholder outfits or phantom plans', () => {
  const empty = buildWeekSuggestions({ ...options, items: [] });
  assert.deepEqual(empty.proposals, []);
  assert.ok(empty.days.every(value => value.status === 'unavailable' && !value.proposal));
  const plans = weekDates(options.startDate).map((date, index) => ({ id: `plan${index}`, date, slot: 'day', outfitId: 'outfit' }));
  const full = buildWeekSuggestions({ ...options, plans });
  assert.deepEqual(full.proposals, []);
  assert.ok(full.days.every(value => value.status === 'occupied'));
});

test('manual conditions are explicit assumptions and disabled weather ignores the forecast', () => {
  const manualWeather = { feelsLike: 20, rainProbability: null, windSpeed: null };
  const result = buildWeekSuggestions({ ...options, weatherMode: 'manual', manualWeather });
  assert.ok(result.days.every(day => day.weather?.feelsLike === 20));
  assert.ok(result.warnings.some(value => value.includes('не являются прогнозом')));
  const ignored = buildWeekSuggestions({ ...options, forecast: { days: [{ date: options.startDate, feelsMin: -20 }] } });
  assert.equal(ignored.days[0].weather, null);
  assert.equal(ignored.proposals.length, 7);
  assert.throws(() => buildWeekSuggestions({ ...options, weatherMode: 'manual' }));
  assert.throws(() => buildWeekSuggestions({ ...options, slot: 'night' }));
  assert.throws(() => buildWeekSuggestions({ ...options, weatherMode: 'invented' }));
  assert.throws(() => buildWeekSuggestions({ ...options, startDate: '2026-10-29' }));
});
