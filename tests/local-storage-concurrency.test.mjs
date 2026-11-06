import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserStorage } from '../lib/data/storage.js';
import { createClosetController, putItem } from '../lib/data/closet-state.js';
import { emptyState } from '../lib/data/model.js';

// A transactional IndexedDB double. Requests queued by a success handler are
// processed before commit, and readwrite transactions share one serialized
// store, as real IndexedDB connections in separate tabs do.
function indexedDatabase(initial = []) {
  let records = new Map(initial.map(([key, value]) => [key, structuredClone(value)]));
  let active = false;
  let failWrite = false;
  const pending = [];
  const events = [];
  const pump = () => {
    if (active || !pending.length) return;
    active = true;
    const start = pending.shift();
    queueMicrotask(start);
  };
  const database = {
    objectStoreNames: { contains: (name) => name === 'data' },
    close() {},
    transaction(storeName, mode) {
      assert.equal(storeName, 'data');
      let local;
      let aborted = false;
      let finished = false;
      let running = false;
      let wrote = false;
      const requests = [];
      const id = events.length;
      events.push({ id, mode, operations: [] });
      const finish = () => {
        if (finished) return;
        finished = true;
        if (!aborted && wrote && failWrite) {
          failWrite = false;
          aborted = true;
          tx.error = new DOMException('Storage full', 'QuotaExceededError');
        }
        if (aborted) tx.onabort?.();
        else {
          if (mode === 'readwrite') records = local;
          tx.oncomplete?.();
        }
        active = false;
        pump();
      };
      const step = () => {
        if (aborted) return finish();
        const next = requests.shift();
        if (!next) return finish();
        next();
        queueMicrotask(step);
      };
      const enqueue = (operation) => {
        if (finished || aborted)
          throw new DOMException('Inactive transaction', 'TransactionInactiveError');
        requests.push(operation);
      };
      const tx = {
        error: null,
        abort() {
          aborted = true;
          if (!running) return;
          queueMicrotask(finish);
        },
        objectStore() {
          return {
            get(key) {
              const request = {};
              events[id].operations.push(['get', key]);
              enqueue(() => {
                request.result = structuredClone(local.get(key));
                request.onsuccess?.();
              });
              return request;
            },
            put(value, key) {
              assert.equal(mode, 'readwrite');
              const clone = structuredClone(value);
              const request = {};
              events[id].operations.push(['put', key]);
              enqueue(() => {
                local.set(key, clone);
                wrote = true;
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
      pending.push(() => {
        running = true;
        local = structuredClone(records);
        step();
      });
      pump();
      return tx;
    },
  };
  return {
    events,
    indexedDB: {
      open(name, version) {
        assert.equal(name, 'mycloset-local-v1');
        assert.equal(version, 1);
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          request.onsuccess?.();
        });
        return request;
      },
    },
    read: (key = 'state') => structuredClone(records.get(key)),
    failNextWrite: () => {
      failWrite = true;
    },
  };
}

function wardrobe(name) {
  const state = emptyState();
  putItem(state, {
    id: 'garment',
    name,
    category: 'top',
    colors: ['white'],
    seasons: ['summer'],
  });
  return state;
}

test('a stale tab cannot overwrite a newer wardrobe, and the check and put share one transaction', async () => {
  const database = indexedDatabase();
  const first = createBrowserStorage(database);
  const second = createBrowserStorage(database);
  assert.equal(await first.load(), undefined);
  assert.equal(await second.load(), undefined);
  const latest = wardrobe('Новая рубашка');
  await first.save(latest);
  await assert.rejects(second.save(wardrobe('Старая вкладка')), { code: 'LOCAL_WARDROBE_CONFLICT' });
  assert.deepEqual(database.read(), latest);
  assert.equal(second.hasState, false);
  const write = database.events.find((entry) =>
    entry.operations.some(([operation]) => operation === 'put'),
  );
  assert.equal(write.mode, 'readwrite');
  assert.deepEqual(write.operations, [['get', 'state'], ['put', 'state']]);
  assert.equal(database.events.at(-1).operations.length, 1);
});

test('concurrent controller writes in two tabs retain the successful wardrobe and never publish the rejected draft', async () => {
  const database = indexedDatabase();
  const published = [[], []];
  const controllers = published.map((changes) =>
    createClosetController(createBrowserStorage(database), (view) =>
      changes.push(structuredClone(view.state)),
    ),
  );
  await Promise.all(controllers.map((controller) => controller.initialize()));
  const results = await Promise.allSettled(
    controllers.map((controller, index) => controller.update(() => wardrobe(`Вещь ${index}`))),
  );
  const winner = results.findIndex((result) => result.status === 'fulfilled');
  const loser = 1 - winner;
  assert.equal(results[loser].status, 'rejected');
  assert.equal(results[loser].reason.code, 'LOCAL_WARDROBE_CONFLICT');
  assert.deepEqual(database.read(), controllers[winner].snapshot().state);
  assert.equal(controllers[loser].snapshot().state.items.length, 0);
  assert.equal(controllers[loser].snapshot().storageMode, 'persistent');
  assert.equal(published[loser].length, 1);
  assert.equal(published[winner].length, 2);
});

test('own sequential saves continue working and reloading a stale storage explicitly adopts the latest baseline', async () => {
  const database = indexedDatabase();
  const first = createBrowserStorage(database);
  const second = createBrowserStorage(database);
  await Promise.all([first.load(), second.load()]);
  await first.save(wardrobe('Первая'));
  await first.save(wardrobe('Вторая'));
  await assert.rejects(second.save(wardrobe('Старая')), { code: 'LOCAL_WARDROBE_CONFLICT' });
  assert.equal((await second.load()).items[0].name, 'Вторая');
  await second.save(wardrobe('Третья'));
  assert.equal(database.read().items[0].name, 'Третья');
  await assert.rejects(first.save(wardrobe('Четвёртая')), { code: 'LOCAL_WARDROBE_CONFLICT' });
});

test('guest and separate account keys retain independent concurrency baselines', async () => {
  const database = indexedDatabase();
  const keys = ['state', 'account:first-user', 'account:second-user'];
  const stores = keys.map((key) => createBrowserStorage({ ...database, key }));
  await Promise.all(stores.map((storage) => storage.load()));
  await Promise.all(stores.map((storage, index) => storage.save(wardrobe(`Своя ${index}`))));
  keys.forEach((key, index) =>
    assert.equal(database.read(key).items[0].name, `Своя ${index}`),
  );
  await stores[0].save(emptyState());
  assert.equal(database.read(keys[1]).items.length, 1);
  assert.equal(database.read(keys[2]).items.length, 1);
});

test('reset from an outdated tab is rejected without clearing current storage or its published wardrobe', async () => {
  const initial = wardrobe('Исходная');
  const database = indexedDatabase([['state', initial]]);
  const first = createClosetController(createBrowserStorage(database));
  const second = createClosetController(createBrowserStorage(database));
  await Promise.all([first.initialize(), second.initialize()]);
  await first.update((state) => {
    state.profile.name = 'Новое имя';
  });
  await assert.rejects(second.reset(), { code: 'LOCAL_WARDROBE_CONFLICT' });
  assert.deepEqual(second.snapshot().state, initial);
  assert.deepEqual(database.read(), first.snapshot().state);
  await first.reset();
  assert.deepEqual(database.read(), emptyState());
});

test('a legacy wardrobe migrates without changing its backing format until the first checked save', async () => {
  const legacy = {
    version: 1,
    profile: { name: 'Амина', city: '', styles: '', colors: [] },
    items: [],
    outfits: [],
    plans: [],
  };
  const database = indexedDatabase([['state', legacy]]);
  const controller = createClosetController(createBrowserStorage(database));
  await controller.initialize();
  assert.deepEqual(database.read(), legacy);
  await controller.update((state) => {
    state.profile.city = 'Кызылорда';
  });
  assert.equal(database.read().version, 5);
  assert.equal(database.read().profile.name, 'Амина');
  assert.equal(database.read().profile.city, 'Кызылорда');
});

test('explicit reset can recover an observed invalid record, but cannot overwrite a newer record', async () => {
  const invalid = { version: 4, damaged: true };
  const database = indexedDatabase([['state', invalid]]);
  const stale = createClosetController(createBrowserStorage(database));
  const current = createClosetController(createBrowserStorage(database));
  await Promise.all([stale.initialize(), current.initialize()]);
  assert.equal(stale.snapshot().storageMode, 'memory');
  assert.deepEqual(database.read(), invalid);
  await current.reset();
  await current.update(() => wardrobe('Восстановленная'));
  await assert.rejects(stale.reset(), { code: 'LOCAL_WARDROBE_CONFLICT' });
  assert.equal(database.read().items[0].name, 'Восстановленная');
});

test('an aborted write does not advance the baseline or claim persisted data, and a later retry succeeds', async () => {
  const database = indexedDatabase();
  const storage = createBrowserStorage(database);
  await storage.load();
  database.failNextWrite();
  await assert.rejects(storage.save(wardrobe('Попытка')), /Не хватает места/);
  assert.equal(storage.hasState, false);
  assert.equal(database.read(), undefined);
  await storage.save(wardrobe('Сохранённая'));
  assert.equal(storage.hasState, true);
  assert.equal(database.read().items[0].name, 'Сохранённая');
});

test('undo in an old tab cannot overwrite a newer persisted edit from another tab', async () => {
  const database = indexedDatabase();
  const first = createClosetController(createBrowserStorage(database));
  await first.initialize();
  await first.update(() => wardrobe('Первая вещь'));
  const second = createClosetController(createBrowserStorage(database));
  await second.initialize();
  await second.update((state) => { state.profile.name = 'Правка другой вкладки'; });
  const stored = database.read();
  await assert.rejects(first.undo(), { code: 'LOCAL_WARDROBE_CONFLICT' });
  assert.deepEqual(database.read(), stored);
  assert.equal(first.snapshot().state.items.length, 1);
  assert.equal(first.snapshot().canUndo, true);
});

test('undo stays inside its account storage and a fresh account never inherits another account undo', async () => {
  const database = indexedDatabase();
  const first = createClosetController(createBrowserStorage({ ...database, key: 'account:first' }));
  const second = createClosetController(createBrowserStorage({ ...database, key: 'account:second' }));
  await Promise.all([first.initialize(), second.initialize()]);
  await first.update(() => wardrobe('Первый аккаунт'));
  assert.equal(second.snapshot().canUndo, false);
  await assert.rejects(second.undo());
  await second.update(() => wardrobe('Второй аккаунт'));
  await first.undo();
  assert.deepEqual(database.read('account:first'), emptyState());
  assert.equal(database.read('account:second').items[0].name, 'Второй аккаунт');
});
