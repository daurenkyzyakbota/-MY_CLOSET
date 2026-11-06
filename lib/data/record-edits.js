const editableCollections = new Set(['items', 'outfits', 'shoppingList', 'plans', 'capsules', 'trips']);

export function sameStoredValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]))
  );
}

// Check the record shown when a form opened inside the serialized mutation.
// Other records may change freely; a stale editor must not overwrite a remote
// edit, undo packing progress, or recreate a record that was deleted meanwhile.
export function assertRecordUnchanged(state, collection, id, expectedRecord) {
  if (!editableCollections.has(collection)) throw new Error('Неизвестный раздел гардероба.');
  if (expectedRecord === undefined) return;
  const current = state[collection].find((record) => record.id === id) || null;
  if (!sameStoredValue(current, expectedRecord)) {
    const error = new Error(
      'Запись изменилась или была удалена, пока форма была открыта. Изменения не сохранены. Откройте форму заново и повторите правку.',
    );
    error.code = 'LOCAL_RECORD_CONFLICT';
    throw error;
  }
}
