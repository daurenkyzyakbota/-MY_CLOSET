const DATABASE = 'mycloset-local-v1';
const STORE = 'data';
const KEY = 'state';

export function createBrowserStorage({
  indexedDB = globalThis.indexedDB,
  timeoutMs = 6000,
  onVersionChange = () => {},
  key = KEY,
} = {}) {
  if (typeof key !== 'string' || (key !== KEY && !/^account:[a-zA-Z0-9_-]{1,200}$/.test(key)))
    throw new Error('Некорректный ключ личного гардероба.');
  let database = null;
  let hasState = false;
  let opening = null;
  let closed = false;
  let loaded = false;
  let expectedRecord;
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
  async function load() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(key);
      let value;
      let fingerprint;
      let failure;
      request.onsuccess = () => {
        try {
          value = request.result;
          fingerprint = JSON.stringify(value);
        } catch (cause) {
          failure = cause;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        hasState = value !== undefined;
        expectedRecord = fingerprint;
        loaded = true;
        resolve(value);
      };
      transaction.onerror = transaction.onabort = () =>
        reject(
          failure || transaction.error || request.error || new Error('Не удалось прочитать гардероб.'),
        );
    });
  }
  return {
    available,
    get hasState() {
      return hasState;
    },
    load,
    async save(value) {
      if (!loaded) await load();
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const request = store.get(key);
        let fingerprint;
        let failure;
        request.onsuccess = () => {
          try {
            // Compare and write in the same transaction: another tab cannot
            // replace the wardrobe between this check and the put request.
            if (JSON.stringify(request.result) !== expectedRecord) {
              failure = new Error(
                'Гардероб изменился в другой вкладке. Изменения не сохранены. Скачайте резервную копию этой вкладки, если она нужна, затем перезагрузите страницу.',
              );
              failure.code = 'LOCAL_WARDROBE_CONFLICT';
              transaction.abort();
              return;
            }
            fingerprint = JSON.stringify(value);
            store.put(value, key);
          } catch (cause) {
            failure = cause;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          hasState = true;
          expectedRecord = fingerprint;
          resolve();
        };
        transaction.onerror = transaction.onabort = () =>
          reject(
            failure ||
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
