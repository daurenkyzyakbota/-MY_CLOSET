const MISSING = Symbol('missing');
const object = (value) => value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = (value) => value === MISSING ? MISSING : structuredClone(value);
// Compare photo strings directly instead of allocating several full JSON
// copies of a wardrobe on every field comparison or radio-button selection.
const equal = (left, right) => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => equal(entry, right[index]));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
};
const identified = (values) => Array.isArray(values) && values.every((entry) => object(entry) && typeof entry.id === 'string') && new Set(values.map((entry) => entry.id)).size === values.length;

/** Inputs stay immutable. Unresolved choices never constitute an approved save. */
export function mergeWardrobes(base, local, cloud, choices = {}) {
  if (![base, local, cloud].every(object)) throw new Error('Для объединения нужны три копии гардероба.');
  const conflicts = [];
  const choose = (path, left, right, kind = 'field', title = '') => {
    const id = JSON.stringify(path);
    const selection = choices[id];
    conflicts.push({
      id, path, kind, title, choice: ['local', 'cloud'].includes(selection) ? selection : '',
      local: left === MISSING ? null : copy(left), cloud: right === MISSING ? null : copy(right),
      localMissing: left === MISSING, cloudMissing: right === MISSING,
    });
    return copy(selection === 'cloud' ? right : left);
  };
  // Moving a record into or out of the bin is one logical operation. Resolving
  // its active record separately from its trash entry could retain both copies.
  const versions = [base, local, cloud].map((state) => ({ ...state }));
  for (const [collection, type] of [['items', 'item'], ['outfits', 'outfit']]) {
    const states = versions.map((state) => {
      const entries = new Map();
      for (const record of state[collection] || []) entries.set(record.id, {
        status: 'active', record,
        ...(type === 'outfit' ? { plans: (state.plans || []).filter((plan) => plan.outfitId === record.id) } : {}),
      });
      for (const entry of state.trash || []) if (entry.type === type) entries.set(entry.record.id, { status: 'trash', entry });
      return entries;
    });
    const ids = new Set(states.flatMap((state) => [...state.keys()]));
    for (const id of ids) {
      const values = states.map((state) => state.get(id) || MISSING);
      const [original, left, right] = values;
      const sameLocation = left?.status === right?.status && !(left?.status === 'trash' && left.entry.id !== right.entry.id);
      if (sameLocation || equal(left, right) || equal(original, left) || equal(original, right)) continue;
      const title = left?.record?.name || right?.record?.name || left?.entry?.record?.name || right?.entry?.record?.name || id;
      const selected = choose([collection, `@${id}`, '$lifecycle'], left, right, 'lifecycle', title);
      const selectedSide = choices[JSON.stringify([collection, `@${id}`, '$lifecycle'])] === 'cloud' ? versions[2] : versions[1];
      const affectedPlans = new Set(type === 'outfit' ? versions.flatMap((state) => (state.plans || []).filter((plan) => plan.outfitId === id).map((plan) => plan.id)) : []);
      const affectedShopping = new Set(type === 'item' ? versions.flatMap((state) => [
        ...(state.shoppingList || []).filter((entry) => entry.itemId === id).map((entry) => entry.id),
        ...(state.trash || []).filter((entry) => entry.type === type && entry.record.id === id).flatMap((entry) => entry.shoppingIds || []),
      ]) : []);
      const selectedLinks = new Map((selectedSide.shoppingList || []).map((entry) => [entry.id, entry.itemId]));
      for (const state of versions) {
        state[collection] = (state[collection] || []).filter((record) => record.id !== id);
        if (Object.hasOwn(state, 'trash')) state.trash = state.trash.filter((entry) => entry.type !== type || entry.record.id !== id);
        if (selected?.status === 'active') state[collection].push(copy(selected.record));
        else if (selected?.status === 'trash') state.trash = [...(state.trash || []), copy(selected.entry)];
        if (type === 'outfit' && state.plans) state.plans = [
          ...state.plans.filter((plan) => !affectedPlans.has(plan.id)),
          ...(selected?.status === 'active' ? copy(selected.plans || []) : []),
        ];
        if (type === 'item' && state.shoppingList) state.shoppingList = state.shoppingList.map((entry) =>
          affectedShopping.has(entry.id) ? { ...entry, itemId: selectedLinks.get(entry.id) || '' } : entry,
        );
      }
    }
  }
  const merge = (original, left, right, path, title = '') => {
    if (equal(left, right)) return copy(left);
    if (equal(original, left)) return copy(right);
    if (equal(original, right)) return copy(left);
    if (left === MISSING || right === MISSING) return choose(path, left, right, 'deletion', title);
    if (object(left) && object(right) && (object(original) || original === MISSING)) {
      const result = {};
      const previous = original === MISSING ? {} : original;
      const keys = new Set([...Object.keys(previous), ...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        const value = merge(Object.hasOwn(previous, key) ? previous[key] : MISSING, Object.hasOwn(left, key) ? left[key] : MISSING, Object.hasOwn(right, key) ? right[key] : MISSING, [...path, key], title);
        if (value !== MISSING) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    if (identified(left) && identified(right) && (identified(original) || original === MISSING)) {
      const previous = original === MISSING ? [] : original;
      const maps = [previous, left, right].map((entries) => new Map(entries.map((entry) => [entry.id, entry])));
      const ids = [...new Set([...left.map((entry) => entry.id), ...right.map((entry) => entry.id), ...previous.map((entry) => entry.id)])];
      const records = new Map();
      for (const id of ids) {
        const values = maps.map((map) => map.get(id) ?? MISSING);
        const label = values.find((value) => value !== MISSING)?.name || values.find((value) => value !== MISSING)?.title || id;
        const value = merge(...values, [...path, `@${id}`], label);
        if (value !== MISSING) records.set(id, value);
      }
      const retained = previous.map((entry) => entry.id).filter((id) => records.has(id) && maps[1].has(id) && maps[2].has(id));
      const order = (entries) => entries.map((entry) => entry.id).filter((id) => retained.includes(id));
      const before = order(previous), localOrder = order(left), cloudOrder = order(right);
      let selectedOrder = equal(localOrder, before) ? right : left;
      if (!equal(localOrder, before) && !equal(cloudOrder, before) && !equal(localOrder, cloudOrder)) {
        const value = choose([...path, '$order'], left.map((entry) => entry.id), right.map((entry) => entry.id), 'order');
        selectedOrder = value.map((id) => ({ id }));
      }
      const sorted = [...new Set([...selectedOrder.map((entry) => entry.id), ...ids])];
      return sorted.filter((id) => records.has(id)).map((id) => records.get(id));
    }
    return choose(path, left, right, 'field', title);
  };
  const snapshot = merge(...versions, []);
  // Different plan IDs can still claim the same calendar slot. Present that
  // semantic collision instead of producing a snapshot the model will reject.
  const slots = new Map();
  for (const plan of snapshot.plans || []) {
    if (typeof plan.date !== 'string' || typeof plan.slot !== 'string') continue;
    const key = JSON.stringify([plan.date, plan.slot]);
    slots.set(key, [...(slots.get(key) || []), plan]);
  }
  for (const [key, plans] of slots) {
    if (plans.length < 2) continue;
    const [day, slot] = JSON.parse(key);
    const matching = (state) => (state.plans || []).filter((plan) => plan.date === day && plan.slot === slot);
    const selected = choose(['plans', '$slot', day, slot], matching(local), matching(cloud), 'schedule', `${day} · ${slot === 'day' ? 'День' : 'Вечер'}`);
    const removedIds = new Set(plans.map((plan) => plan.id));
    const mergedPlans = new Map(plans.map((plan) => [plan.id, plan]));
    snapshot.plans = [
      ...snapshot.plans.filter((plan) => !removedIds.has(plan.id)),
      ...selected.map((plan) => mergedPlans.get(plan.id) || copy(plan)),
    ];
  }
  return { snapshot, conflicts, unresolved: conflicts.filter((entry) => !entry.choice).length };
}

export function assertMergePreviewCurrent(preview, { userId, localHash, revision }) {
  const fail = (message, code) => { const error = new Error(message); error.status = 409; error.code = code; throw error; };
  if (!preview?.base || !preview.cloud || preview.userId !== userId)
    fail('Сначала проверьте объединение гардеробов.', 'MERGE_PREVIEW_REQUIRED');
  if (preview.localHash !== localHash)
    fail('На устройстве появились новые изменения. Постройте объединение ещё раз.', 'LOCAL_CHANGED');
  if (preview.revision !== revision)
    fail('Облако обновилось на другом устройстве. Постройте объединение ещё раз.', 'CLOUD_CHANGED');
}

const labels = {
  items: 'Вещи', outfits: 'Образы', plans: 'Календарь', shoppingList: 'Покупки',
  wearLog: 'История носки', capsules: 'Капсулы', trips: 'Поездки', profile: 'Личный профиль', trash: 'Корзина',
  name: 'Название', city: 'Город', styles: 'Стили', colors: 'Цвета', photo: 'Фотография',
  favorite: 'Избранное', available: 'Доступность', note: 'Заметка', notes: 'Заметки',
  '$order': 'Порядок записей', '$lifecycle': 'Удаление или восстановление',
  '$slot': 'Время в календаре',
};
export function conflictLabel(conflict) {
  const fields = conflict.path.filter((part) => !part.startsWith('@')).map((part) => labels[part] || part);
  if (conflict.title) fields.splice(1, 0, conflict.title);
  return fields.join(' · ');
}
