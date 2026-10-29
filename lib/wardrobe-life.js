import {
  emptyState, localDate, validDate, validateState, uid, outfitStatus,
  WEAR_ITEM_LIMIT, MAX_WEAR_RECORDS, MAX_WEAR_REFERENCES, MAX_CAPSULES, MAX_TRIPS
} from './model.js';

const dayNumber = date => Date.parse(`${date}T00:00:00.000Z`) / 86400000;
const wearKey = entry => JSON.stringify([entry.date, entry.outfitId, [...entry.itemIds].sort()]);

// Validate the proposed record before touching the caller's draft. Existing records
// are validated by the controller; photos need not be cloned for this local check.
function checkedRecord(collection, record) {
  return validateState({ ...emptyState(), [collection]: [record] })[collection][0];
}

function removeRecord(state, collection, id) {
  const removed = state[collection].find(record => record.id === id) || null;
  if (removed) state[collection] = state[collection].filter(record => record.id !== id);
  return removed;
}

/** Mutates a controller draft, like putItem/putOutfit, and returns the new record. */
export function markWorn(state, { date = localDate(), outfitId = '', itemIds, notes = '' } = {}) {
  let selected = itemIds;
  if (outfitId) {
    const outfit = state.outfits.find(record => record.id === outfitId);
    if (!outfit) throw new Error('Образ больше не найден. Выберите другой образ или отдельные вещи.');
    if (!outfitStatus(outfit, state.items).complete) throw new Error('В образе есть удалённые, недостающие вещи или вещи в стирке. Сначала обновите его состав.');
    if (selected === undefined) selected = outfit.itemIds;
  }
  const entry = checkedRecord('wearLog', { id: uid(), date, itemIds: selected === undefined ? [] : selected, outfitId, notes });
  const owned = new Map(state.items.map(item => [item.id, item]));
  for (const id of entry.itemIds) {
    const item = owned.get(id);
    if (!item) throw new Error('Одна из вещей больше не найдена в гардеробе. Обновите выбор.');
    if (!item.available) throw new Error(`«${item.name}» сейчас в стирке. Сначала верните вещь в гардероб.`);
  }
  if (state.wearLog.length >= MAX_WEAR_RECORDS) throw new Error(`В истории допустимо не более ${MAX_WEAR_RECORDS} отметок. Удалите ненужные отметки.`);
  if (state.wearLog.reduce((sum, record) => sum + record.itemIds.length, 0) + entry.itemIds.length > MAX_WEAR_REFERENCES) {
    throw new Error(`В истории допустимо не более ${MAX_WEAR_REFERENCES} ссылок на вещи.`);
  }
  const key = wearKey(entry);
  if (state.wearLog.some(record => wearKey(record) === key)) throw new Error('Эти вещи уже отмечены надетыми на эту дату.');
  state.wearLog.push(entry);
  return entry;
}

export function removeWear(state, id) { return removeRecord(state, 'wearLog', id); }

export function saveCapsule(state, draft) {
  const existing = state.capsules.find(record => record.id === draft.id);
  const capsule = checkedRecord('capsules', {
    name: '', description: '', itemIds: [], outfitIds: [], ...existing, ...draft,
    id: existing?.id || draft.id || uid(), createdAt: existing?.createdAt || draft.createdAt || new Date().toISOString()
  });
  if (existing) state.capsules = state.capsules.map(record => record.id === capsule.id ? capsule : record);
  else {
    if (state.capsules.length >= MAX_CAPSULES) throw new Error(`Допустимо не более ${MAX_CAPSULES} капсул.`);
    state.capsules.push(capsule);
  }
  return capsule;
}

export function removeCapsule(state, id) { return removeRecord(state, 'capsules', id); }

export function saveTrip(state, draft) {
  const existing = state.trips.find(record => record.id === draft.id);
  const trip = checkedRecord('trips', {
    name: '', destination: '', startDate: '', endDate: '', itemIds: [], outfitIds: [], packedItemIds: [], notes: '',
    ...existing, ...draft, id: existing?.id || draft.id || uid(),
    createdAt: existing?.createdAt || draft.createdAt || new Date().toISOString()
  });
  if (existing) state.trips = state.trips.map(record => record.id === trip.id ? trip : record);
  else {
    if (state.trips.length >= MAX_TRIPS) throw new Error(`Допустимо не более ${MAX_TRIPS} поездок.`);
    state.trips.push(trip);
  }
  return trip;
}

export function removeTrip(state, id) { return removeRecord(state, 'trips', id); }

export function toggleTripPacked(state, tripId, itemId) {
  const trip = state.trips.find(record => record.id === tripId);
  if (!trip) throw new Error('Поездка больше не найдена.');
  if (!trip.itemIds.includes(itemId)) throw new Error('Эта вещь не входит в список поездки.');
  const packed = trip.packedItemIds.includes(itemId);
  if (!packed && !state.items.some(item => item.id === itemId)) throw new Error('Удалённую вещь нельзя отметить собранной.');
  return saveTrip(state, {
    id: tripId,
    packedItemIds: packed ? trip.packedItemIds.filter(id => id !== itemId) : [...trip.packedItemIds, itemId]
  });
}

/** Current garments only; deleted references still count in the retained wear log. */
export function getWearStatistics(state, today = localDate()) {
  if (!validDate(today)) throw new Error('Укажите корректную дату для статистики.');
  const counts = new Map();
  const last = new Map();
  let totalWears = 0;
  for (const entry of state.wearLog) {
    if (entry.date > today) continue;
    totalWears += 1;
    for (const id of entry.itemIds) {
      counts.set(id, (counts.get(id) || 0) + 1);
      if (!last.has(id) || entry.date > last.get(id)) last.set(id, entry.date);
    }
  }
  const items = state.items.map(item => {
    const lastWorn = last.get(item.id) || null;
    return { item, id: item.id, wearCount: counts.get(item.id) || 0, lastWorn, daysSinceLastWorn: lastWorn === null ? null : dayNumber(today) - dayNumber(lastWorn) };
  });
  const mostWorn = items.filter(row => row.wearCount > 0)
    .sort((a, b) => b.wearCount - a.wearCount || a.item.name.localeCompare(b.item.name, 'ru') || a.id.localeCompare(b.id, 'en')).slice(0, 5);
  return { items, totalWears, neverWornCount: items.filter(row => row.wearCount === 0).length, mostWorn };
}

export { WEAR_ITEM_LIMIT };
