import { MAX_ITEMS } from './model.js';

export const BATCH_ITEM_ACTIONS = Object.freeze({
  favorite: 'В избранное',
  unfavorite: 'Убрать из избранного',
  laundry: 'В стирку',
  available: 'Вернуть из стирки',
  delete: 'Удалить',
});

/** Validate every selected ID before mutating the transaction's draft. */
export function applyItemBatch(state, itemIds, action) {
  if (!Object.hasOwn(BATCH_ITEM_ACTIONS, action)) throw new Error('Выберите действие с вещами.');
  if (
    !Array.isArray(itemIds) ||
    !itemIds.length ||
    itemIds.length > MAX_ITEMS ||
    itemIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) ||
    new Set(itemIds).size !== itemIds.length
  )
    throw new Error('Выберите вещи из текущего списка.');
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const selected = itemIds.map((id) => byId.get(id));
  if (selected.some((item) => !item))
    throw new Error('Часть выбранных вещей уже удалена. Обновите список и выберите вещи снова.');
  const ids = new Set(itemIds);
  let changedCount = 0;
  if (action === 'delete') {
    state.items = state.items.filter((item) => !ids.has(item.id));
    state.shoppingList = state.shoppingList.map((entry) =>
      ids.has(entry.itemId) ? { ...entry, itemId: '' } : entry,
    );
    // Outfits, wear history, capsules, trips and plans retain their references.
    // Their existing missing-item UI lets the person inspect historical records.
    changedCount = selected.length;
  } else {
    const key = ['favorite', 'unfavorite'].includes(action) ? 'favorite' : 'available';
    const value = action === 'favorite' || action === 'available';
    for (const item of selected) {
      if (item[key] !== value) changedCount++;
      item[key] = value;
    }
  }
  return { count: selected.length, changedCount };
}
