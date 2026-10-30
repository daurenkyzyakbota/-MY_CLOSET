const DATABASE = 'mycloset-local-v1';
const STORE = 'data';
const KEY = 'state';

export function createBrowserStorage({
  indexedDB = globalThis.indexedDB,
  timeoutMs = 6000,
  onVersionChange = () => {},
} = {}) {
  let database = null;
  let opening = null;
  let closed = false;
  const available = !!indexedDB;
  async function open() {
    if (closed) throw new Error('Хранилище закрыто. Перезагрузите страницу.');
    if (!indexedDB) throw new Error('Браузер не поддерживает локальное сохранение.');
    if (database) return database;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let finished = false;
      const request = indexedDB.open(DATABASE, 1);
      const timer = setTimeout(() => {
        finished = true;
        reject(new Error('Браузер не разрешил открыть хранилище.'));
      }, timeoutMs);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (!finished) {
          finished = true;
          reject(request.error || new Error('Хранилище недоступно.'));
        }
      };
      request.onblocked = () => {
        /* The timeout gives an existing tab time to release its connection. */
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (finished || closed) {
          request.result.close();
          if (!finished) {
            finished = true;
            reject(new Error('Хранилище закрыто.'));
          }
          return;
        }
        finished = true;
        database = request.result;
        database.onversionchange = () => {
          database?.close();
          database = null;
          onVersionChange('Хранилище обновлено в другой вкладке. Перезагрузите страницу.');
        };
        resolve(database);
      };
    }).finally(() => {
      opening = null;
    });
    return opening;
  }
  return {
    available,
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readonly');
        const request = transaction.objectStore(STORE).get(KEY);
        let value;
        request.onsuccess = () => {
          value = request.result;
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error || request.error || new Error('Не удалось прочитать гардероб.'));
      });
    },
    async save(value) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).put(value, KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(
            new Error(
              transaction.error?.name === 'QuotaExceededError'
                ? 'Не хватает места для фотографий. Скачайте копию и уменьшите изображения. Изменения не сохранены.'
                : 'Не удалось сохранить изменения. Проверьте доступ к хранилищу браузера.',
            ),
          );
      });
    },
    close() {
      closed = true;
      database?.close();
      database = null;
    },
  };
}

export async function removeLegacyWorker(
  navigatorObject = globalThis.navigator,
  cacheStorage = globalThis.caches,
) {
  if (!navigatorObject?.serviceWorker) return;
  const registrations = await navigatorObject.serviceWorker.getRegistrations();
  // Only the former MyCloset worker is retired; unrelated workers and all IndexedDB data stay intact.
  for (const registration of registrations) {
    const worker = registration.active || registration.waiting || registration.installing;
    if (!worker) continue;
    const url = new URL(worker.scriptURL);
    if (
      url.origin !== globalThis.location?.origin ||
      url.pathname !== '/sw.js' ||
      new URL(registration.scope).pathname !== '/'
    )
      continue;
    const keys = cacheStorage ? await cacheStorage.keys() : [];
    if (!keys.some((key) => key.startsWith('mycloset-shell-'))) continue;
    await registration.unregister();
    for (const key of keys) if (key.startsWith('mycloset-shell-')) await cacheStorage.delete(key);
  }
}
