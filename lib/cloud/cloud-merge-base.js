const DATABASE = 'mycloset-local-v1';
const STORE = 'data';
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id);
export const cloudBaseKey = (userId) => {
  if (!validId(userId)) throw new Error('Некорректный аккаунт базовой копии.');
  return `cloud-base:${userId}`;
};

/** Separate IDB records keep full photos out of localStorage and wardrobe keys. */
export function createCloudBaseStorage({ indexedDB = globalThis.indexedDB, timeoutMs = 6000 } = {}) {
  async function transaction(userId, record) {
    const key = cloudBaseKey(userId);
    if (!indexedDB) throw new Error('Базовая копия доступна только до закрытия страницы.');
    return new Promise((resolve, reject) => {
      let database;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        database?.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('Не удалось сохранить базовую копию в браузере.')), timeoutMs);
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => finish(request.error || new Error('Локальная базовая копия недоступна.'));
      request.onsuccess = () => {
        database = request.result;
        if (settled) return database.close();
        const tx = database.transaction(STORE, record ? 'readwrite' : 'readonly');
        const store = tx.objectStore(STORE);
        const get = store.get(key);
        let result;
        get.onsuccess = () => {
          result = get.result;
          // A late acknowledgement from another tab cannot replace a newer base.
          if (record && (!result || result.revision <= record.revision)) {
            result = record;
            store.put(record, key);
          }
        };
        tx.oncomplete = () => finish(null, result || null);
        tx.onerror = tx.onabort = () => finish(tx.error || new Error('Не удалось сохранить базовую копию.'));
      };
    });
  }
  return {
    read: (userId) => transaction(userId),
    write: (record) => {
      if (!record || !Number.isSafeInteger(record.revision) || record.revision < 1 || !record.snapshot || !/^[a-f0-9]{64}$/.test(record.hash))
        return Promise.reject(new Error('Некорректная базовая копия.'));
      return transaction(record.userId, record);
    },
  };
}
