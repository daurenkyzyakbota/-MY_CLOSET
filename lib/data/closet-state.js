import { emptyState, validateState, uid, localDate } from './model.js';
export {
  markWorn,
  removeWear,
  saveCapsule,
  removeCapsule,
  saveTrip,
  removeTrip,
  toggleTripPacked,
  getWearStatistics,
} from './wardrobe-life.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
export function createClosetController(storage, onChange = () => {}) {
  let state = emptyState();
  let ready = false;
  let storageMode = 'loading';
  let error = '';
  let queue = Promise.resolve();
  let initializing = null;
  const snapshot = () => ({ state, ready, storageMode, error });
  const publish = () => onChange(snapshot());
  const initialize = () =>
    (initializing ||= (async () => {
      try {
        const value = await storage.load();
        state = value === undefined ? emptyState() : validateState(value);
        storageMode = 'persistent';
      } catch (cause) {
        storageMode = 'memory';
        error = `${cause.message || 'Хранилище недоступно.'} Данные текущего сеанса сохраняются только до закрытия вкладки. Существующая запись не заменена.`;
      }
      ready = true;
      publish();
      return snapshot();
    })());
  function enqueue(work) {
    const operation = queue.then(async () => {
      await initialize();
      return work();
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    initialize,
    snapshot,
    update(updater) {
      return enqueue(async () => {
        const draft = clone(state);
        const result = typeof updater === 'function' ? await updater(draft) : updater;
        const next = validateState(result === undefined ? draft : result);
        if (storageMode === 'persistent') await storage.save(next);
        state = next;
        if (storageMode === 'persistent') error = '';
        publish();
        return next;
      });
    },
    reset() {
      return enqueue(async () => {
        const next = emptyState();
        if (storage.available !== false) {
          await storage.save(next);
          storageMode = 'persistent';
          error = '';
        }
        state = next;
        publish();
        return next;
      });
    },
    disconnect(message) {
      storageMode = 'memory';
      error = message;
      publish();
    },
    close() {
      storage.close?.();
    },
  };
}

export function itemFromDraft(draft, existing) {
  const { shoppingId, ...fields } = draft;
  return {
    name: '',
    category: 'top',
    colors: [],
    seasons: [],
    size: '',
    style: '',
    photo: '',
    favorite: false,
    available: true,
    warmth: 'unknown',
    rainproof: 'unknown',
    subcategory: '',
    material: '',
    brand: '',
    notes: '',
    purchaseDate: '',
    ...existing,
    ...fields,
    id: existing?.id || draft.id || uid(),
    createdAt: existing?.createdAt || draft.createdAt || new Date().toISOString(),
  };
}
export function putItem(state, draft) {
  const existing = state.items.find((item) => item.id === draft.id);
  const item = itemFromDraft(draft, existing);
  if (existing) state.items = state.items.map((value) => (value.id === item.id ? item : value));
  else state.items.push(item);
  if (draft.shoppingId) {
    const shopping = state.shoppingList.find((value) => value.id === draft.shoppingId);
    if (!shopping) throw new Error('Покупка больше не найдена. Откройте форму заново.');
    if (
      shopping.itemId &&
      shopping.itemId !== item.id &&
      state.items.some((value) => value.id === shopping.itemId)
    )
      throw new Error('Эта покупка уже добавлена в гардероб.');
    shopping.status = 'purchased';
    shopping.itemId = item.id;
  }
  return item;
}
export function putOutfit(state, draft) {
  const existing = state.outfits.find((value) => value.id === draft.id);
  const outfit = {
    name: '',
    itemIds: [],
    missingItems: [],
    favorite: false,
    occasion: 'everyday',
    style: '',
    season: '',
    description: '',
    ...existing,
    ...draft,
    id: existing?.id || draft.id || uid(),
    createdAt: existing?.createdAt || draft.createdAt || new Date().toISOString(),
  };
  if (existing)
    state.outfits = state.outfits.map((value) => (value.id === outfit.id ? outfit : value));
  else state.outfits.push(outfit);
  return outfit;
}
export function putShopping(state, draft) {
  const existing = state.shoppingList.find((value) => value.id === draft.id);
  const shopping = {
    name: '',
    category: 'top',
    colors: [],
    season: '',
    style: '',
    size: '',
    budget: null,
    notes: '',
    status: 'planned',
    itemId: '',
    ...existing,
    ...draft,
    id: existing?.id || draft.id || uid(),
    createdAt: existing?.createdAt || draft.createdAt || new Date().toISOString(),
  };
  if (existing)
    state.shoppingList = state.shoppingList.map((value) =>
      value.id === shopping.id ? shopping : value,
    );
  else state.shoppingList.push(shopping);
  return shopping;
}
export function putPlan(state, draft) {
  const existing = state.plans.find((value) => value.id === draft.id);
  const plan = {
    date: localDate(),
    slot: 'day',
    outfitId: '',
    ...existing,
    ...draft,
    id: existing?.id || draft.id || uid(),
  };
  const collision = state.plans.find(
    (value) => value.id !== plan.id && value.date === plan.date && value.slot === plan.slot,
  );
  if (collision)
    throw new Error('На это время уже назначен другой образ. Измените существующий план.');
  if (existing) state.plans = state.plans.map((value) => (value.id === plan.id ? plan : value));
  else state.plans.push(plan);
  return plan;
}
