import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, demoState } from '../lib/data/model.js';
import { everydaySummary } from '../lib/data/daily-summary.js';
import { searchCloset } from '../lib/data/quick-search.js';

test('daily summary treats a calendar plan separately from an actual wear mark', () => {
  const state = demoState();
  const outfit = state.outfits[0];
  state.plans.push({ id: 'plan', date: '2026-10-31', slot: 'day', outfitId: outfit.id });
  assert.equal(everydaySummary(state, '2026-10-31').plans[0].worn, false);
  state.wearLog.push({
    id: 'wear',
    date: '2026-10-31',
    outfitId: '',
    itemIds: [...outfit.itemIds],
    notes: '',
  });
  assert.equal(everydaySummary(state, '2026-10-31').plans[0].worn, true);
  state.items.find((item) => item.id === outfit.itemIds[0]).available = false;
  assert.equal(everydaySummary(state, '2026-10-31').plans[0].complete, false);
});
test('forgotten suggestions ignore laundry and future wear and distinguish missing history', () => {
  const state = demoState();
  state.items = state.items.slice(0, 3);
  state.items[2].available = false;
  state.wearLog = [
    { id: 'future', date: '2026-11-01', outfitId: '', itemIds: [state.items[0].id], notes: '' },
    { id: 'old', date: '2026-09-01', outfitId: '', itemIds: [state.items[1].id], notes: '' },
  ];
  const result = everydaySummary(state, '2026-10-31');
  assert.equal(result.forgotten.length, 2);
  assert.equal(result.forgotten[0].lastWorn, null);
  assert.equal(result.forgotten[1].daysSinceLastWorn, 60);
  assert.equal(result.laundryCount, 1);
});
test('trip reminders retain deleted references rather than showing false completion', () => {
  const state = demoState();
  state.trips = [
    {
      id: 'trip',
      name: 'Алматы',
      destination: '',
      startDate: '2026-11-02',
      endDate: '2026-11-04',
      itemIds: [state.items[0].id, 'deleted'],
      outfitIds: [],
      packedItemIds: [state.items[0].id, 'deleted'],
      notes: '',
      createdAt: new Date().toISOString(),
    },
  ];
  const trip = everydaySummary(state, '2026-10-31').trip;
  assert.equal(trip.total, 2);
  assert.equal(trip.packed, 1);
  assert.equal(trip.missing, 1);
  assert.equal(everydaySummary(state, '2026-11-05').trip, null);
});
test('quick search uses only metadata and creates safe internal links', () => {
  const state = demoState();
  state.items[0].name = 'Тёплая рубашка <script>';
  state.items[0].brand = 'Любимый бренд';
  state.items[0].photo = 'secret-photo-data';
  const result = searchCloset(state, 'теплая рубашка');
  assert.equal(result[0].title, state.items[0].name);
  assert.ok(result[0].href.startsWith('/wardrobe?'));
  assert.equal(
    new URL('https://example.test' + result[0].href).searchParams.get('q'),
    state.items[0].name,
  );
  assert.ok(!JSON.stringify(result).includes('secret-photo-data'));
  assert.equal(searchCloset(emptyState(), 'теплая').length, 0);
  assert.equal(searchCloset(state, 'бренд', { kind: 'outfit' }).length, 0);
  assert.ok(searchCloset(state, 'бренд', { kind: 'item' }).length > 0);
});
