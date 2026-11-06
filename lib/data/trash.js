import { MAX_ITEMS, MAX_TRASH_RECORDS, uid } from './model.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function ensureRoom(state, count) {
  if ((state.trash || []).length + count > MAX_TRASH_RECORDS)
    throw new Error(`В корзине можно хранить до ${MAX_TRASH_RECORDS} записей. Восстановите нужное или очистите корзину перед удалением.`);
}

export function moveItemsToTrash(state, ids, deletedAt = new Date().toISOString()) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
    throw new Error('Выберите вещи для перемещения в корзину.');
  const records = ids.map((id) => state.items.find((record) => record.id === id));
  if (records.some((record) => !record)) throw new Error('Одна из вещей уже удалена. Обновите список.');
  ensureRoom(state, records.length);
  const entries = records.map((record) => ({
    id: uid(),
    type: 'item',
    deletedAt,
    record: clone(record),
    plans: [],
    shoppingIds: state.shoppingList.filter((entry) => entry.itemId === record.id).map((entry) => entry.id),
  }));
  const selected = new Set(ids);
  state.trash = [...(state.trash || []), ...entries];
  state.items = state.items.filter((record) => !selected.has(record.id));
  state.shoppingList = state.shoppingList.map((entry) =>
    selected.has(entry.itemId) ? { ...entry, itemId: '' } : entry,
  );
  return entries;
}

export function moveOutfitToTrash(state, id, deletedAt = new Date().toISOString()) {
  const record = state.outfits.find((entry) => entry.id === id);
  if (!record) throw new Error('Образ уже удалён. Обновите список.');
  ensureRoom(state, 1);
  const entry = {
    id: uid(), type: 'outfit', deletedAt, record: clone(record),
    plans: clone(state.plans.filter((plan) => plan.outfitId === id)), shoppingIds: [],
  };
  state.trash = [...(state.trash || []), entry];
  state.outfits = state.outfits.filter((value) => value.id !== id);
  state.plans = state.plans.filter((plan) => plan.outfitId !== id);
  return entry;
}

export function restoreTrashEntry(state, id, { restorePlans = true } = {}) {
  const entry = (state.trash || []).find((record) => record.id === id);
  if (!entry) throw new Error('Запись больше не найдена в корзине.');
  const collection = entry.type === 'item' ? 'items' : 'outfits';
  if (state[collection].some((record) => record.id === entry.record.id))
    throw new Error('Запись с таким идентификатором уже существует. Текущие данные не заменены.');
  const limit = entry.type === 'item' ? MAX_ITEMS : 500;
  if (state[collection].length >= limit) throw new Error(`В разделе уже ${limit} записей. Сначала освободите место.`);
  const plans = entry.type === 'outfit' && restorePlans ? entry.plans : [];
  if (state.plans.length + plans.length > 5000) throw new Error('Недостаточно места для восстановления планов календаря.');
  if (plans.some((plan) => state.plans.some((current) =>
    current.id === plan.id || (current.date === plan.date && current.slot === plan.slot),
  )))
    throw new Error('Время в календаре уже занято. Можно восстановить образ без его прежних планов.');
  state[collection] = [...state[collection], clone(entry.record)];
  state.plans = [...state.plans, ...clone(plans)];
  if (entry.type === 'item') {
    const shoppingIds = new Set(entry.shoppingIds);
    state.shoppingList = state.shoppingList.map((shopping) =>
      shoppingIds.has(shopping.id) && shopping.status === 'purchased' && !shopping.itemId
        ? { ...shopping, itemId: entry.record.id }
        : shopping,
    );
  }
  state.trash = state.trash.filter((record) => record.id !== id);
  return entry.record;
}

export function permanentlyRemoveTrash(state, id) {
  if (!(state.trash || []).some((record) => record.id === id)) throw new Error('Запись уже удалена из корзины.');
  state.trash = state.trash.filter((record) => record.id !== id);
}

export function clearTrash(state, { expectedIds } = {}) {
  if (expectedIds && (
    expectedIds.length !== (state.trash || []).length ||
    (state.trash || []).some((entry) => !expectedIds.includes(entry.id))
  ))
    throw new Error('Корзина изменилась. Проверьте список и подтвердите очистку заново.');
  state.trash = [];
}
