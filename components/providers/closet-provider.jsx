'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  demoState,
  emptyState,
  localDate,
  MAX_BACKUP_FILE_BYTES,
  validateState,
} from '@/lib/data/model.js';
import {
  createClosetController,
  putItem,
  putOutfit,
  putPlan,
  putShopping,
} from '@/lib/data/closet-state.js';
import { createBrowserStorage, removeLegacyWorker } from '@/lib/data/storage.js';
import { fetchWeather } from '@/lib/weather/weather-client.js';
import {
  markWorn as recordWear,
  removeWear as deleteWear,
  saveCapsule as putCapsule,
  removeCapsule as deleteCapsule,
  saveTrip as putTrip,
  removeTrip as deleteTrip,
  toggleTripPacked as changePacked,
} from '@/lib/data/wardrobe-life.js';
import { applyWeekPlans } from '@/lib/styling/week-plan-save.js';
import { applyItemBatch } from '@/lib/data/item-actions.js';

const ClosetContext = createContext(null);
export function ClosetProvider({ children }) {
  const [view, setView] = useState(() => ({
    state: emptyState(),
    ready: false,
    storageMode: 'loading',
    error: '',
    ownerId: '',
    scopeHasState: false,
  }));
  const controllerRef = useRef(null);
  const ownerRef = useRef(undefined);
  const requestedOwner = useRef('');
  const mounted = useRef(false);
  const switching = useRef(Promise.resolve());
  const memoryCopies = useRef(new Map());
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef(null);
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const weatherCache = useRef(new Map());
  const weatherPending = useRef(new Map());
  const weatherRequest = useRef(0);

  const notify = useCallback((message) => {
    clearTimeout(noticeTimer.current);
    setNotice(String(message));
    noticeTimer.current = setTimeout(() => setNotice(''), 5500);
  }, []);
  const switchOwner = useCallback((nextOwner = '') => {
    if (typeof nextOwner !== 'string' || (nextOwner && !/^[a-zA-Z0-9_-]{1,200}$/.test(nextOwner)))
      return Promise.reject(new Error('Некорректный аккаунт гардероба.'));
    requestedOwner.current = nextOwner;
    const operation = switching.current.then(async () => {
      if (!mounted.current || requestedOwner.current !== nextOwner) return;
      if (ownerRef.current === nextOwner && controllerRef.current) return;
      const previous = controllerRef.current;
      controllerRef.current = null;
      setView({
        state: emptyState(),
        ready: false,
        storageMode: 'loading',
        error: '',
        ownerId: nextOwner,
        scopeHasState: false,
      });
      weatherRequest.current++;
      setWeather(null);
      clearTimeout(noticeTimer.current);
      setNotice('');
      if (previous) {
        await previous.idle();
        if (previous.snapshot().storageMode === 'memory')
          memoryCopies.current.set(ownerRef.current || '', previous.snapshot().state);
        previous.close();
      }
      if (!mounted.current || requestedOwner.current !== nextOwner) return;
      ownerRef.current = nextOwner;
      const storage = createBrowserStorage({
        key: nextOwner ? `account:${nextOwner}` : 'state',
        onVersionChange: (message) => controller.disconnect(message),
      });
      const controller = createClosetController(storage, (next) => {
        if (
          mounted.current &&
          controllerRef.current === controller &&
          requestedOwner.current === nextOwner
        )
          setView({ ...next, ownerId: nextOwner, scopeHasState: storage.hasState });
      });
      controllerRef.current = controller;
      await controller.initialize();
      if (controller.snapshot().storageMode === 'persistent')
        memoryCopies.current.delete(nextOwner);
      if (controller.snapshot().storageMode === 'memory' && memoryCopies.current.has(nextOwner))
        await controller.update(() => memoryCopies.current.get(nextOwner));
    });
    switching.current = operation.catch(() => {});
    return operation;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void switchOwner('');
    void removeLegacyWorker().catch(() => {});
    return () => {
      mounted.current = false;
      weatherRequest.current++;
      clearTimeout(noticeTimer.current);
      controllerRef.current?.close();
      controllerRef.current = null;
      ownerRef.current = undefined;
    };
  }, [switchOwner]);
  const readGuestWardrobe = useCallback(async () => {
    if (memoryCopies.current.has('')) return validateState(memoryCopies.current.get(''));
    const storage = createBrowserStorage();
    try {
      const value = await storage.load();
      return value === undefined ? emptyState() : validateState(value);
    } finally {
      storage.close();
    }
  }, []);
  const updateState = useCallback(
    async (updater, message = '') => {
      const controller = controllerRef.current;
      if (!controller) throw new Error('Подождите, открываем гардероб.');
      const next = await controller.update(updater);
      if (message)
        notify(
          message +
            (controller.snapshot().storageMode === 'memory' ? ' — до закрытия вкладки' : ''),
        );
      return next;
    },
    [notify],
  );

  const loadWeather = useCallback(async (_date, refresh = false) => {
    const location = controllerRef.current?.snapshot().state.profile.location;
    if (!location) {
      weatherRequest.current++;
      setWeather(null);
      setWeatherLoading(false);
      setWeatherError('');
      return null;
    }
    const key = `${location.latitude},${location.longitude}`;
    const requestId = ++weatherRequest.current;
    const cached = weatherCache.current.get(key);
    if (!refresh && cached && Date.now() - cached.at < 10 * 60 * 1000) {
      setWeather(cached.data);
      setWeatherLoading(false);
      setWeatherError('');
      return cached.data;
    }
    setWeatherLoading(true);
    setWeatherError('');
    let promise = weatherPending.current.get(key);
    if (!promise || refresh) {
      promise = fetchWeather(location, refresh).then((data) => {
        weatherCache.current.set(key, { at: Date.now(), data });
        return data;
      });
      weatherPending.current.set(key, promise);
      void promise
        .finally(() => {
          if (weatherPending.current.get(key) === promise) weatherPending.current.delete(key);
        })
        .catch(() => {});
    }
    try {
      const data = await promise;
      if (requestId === weatherRequest.current) setWeather(data);
      return data;
    } catch (error) {
      if (requestId === weatherRequest.current) {
        setWeatherError(
          error.name === 'TimeoutError'
            ? 'Сервис погоды отвечает слишком долго. Укажите условия вручную.'
            : error.message,
        );
        setWeather(null);
      }
      return null;
    } finally {
      if (requestId === weatherRequest.current) setWeatherLoading(false);
    }
  }, []);
  const locationKey = view.state.profile.location
    ? `${view.state.profile.location.latitude},${view.state.profile.location.longitude}`
    : '';
  useEffect(() => {
    if (view.ready) {
      setWeather(null);
      void loadWeather();
    }
  }, [view.ready, locationKey, loadWeather]);

  const actions = useMemo(
    () => ({
      updateState,
      switchOwner,
      readGuestWardrobe,
      importGuestWardrobe: async () => {
        const owner = ownerRef.current;
        if (!owner) throw new Error('Сначала войдите в аккаунт.');
        const snapshot = await readGuestWardrobe();
        if (ownerRef.current !== owner || requestedOwner.current !== owner)
          throw new DOMException('Аккаунт изменился.', 'AbortError');
        return updateState(() => snapshot, 'Локальный гардероб скопирован в этот аккаунт');
      },
      notify,
      loadWeather,
      markWorn: (draft) =>
        updateState((next) => {
          recordWear(next, draft);
        }, 'Отметка носки сохранена'),
      removeWear: (id) =>
        updateState((next) => {
          deleteWear(next, id);
        }, 'Отметка удалена'),
      saveCapsule: (draft) =>
        updateState((next) => {
          putCapsule(next, draft);
        }, 'Капсула сохранена'),
      removeCapsule: (id) =>
        updateState((next) => {
          deleteCapsule(next, id);
        }, 'Капсула удалена'),
      saveTrip: (draft) =>
        updateState((next) => {
          putTrip(next, draft);
        }, 'Поездка сохранена'),
      removeTrip: (id) =>
        updateState((next) => {
          deleteTrip(next, id);
        }, 'Поездка удалена'),
      toggleTripPacked: (tripId, itemId) =>
        updateState((next) => {
          changePacked(next, tripId, itemId);
        }),
      saveWeek: (proposals) =>
        updateState((next) => {
          applyWeekPlans(next, proposals);
        }, 'Образы добавлены в календарь'),
      saveItem: (draft) =>
        updateState(
          (next) => {
            putItem(next, draft);
          },
          draft.id ? 'Вещь обновлена' : 'Вещь добавлена',
        ),
      batchItems: async (ids, action, { ownerId: expectedOwner = ownerRef.current } = {}) => {
        const controller = controllerRef.current;
        const owner = ownerRef.current;
        const accountChanged = () =>
          expectedOwner !== owner ||
          ownerRef.current !== owner ||
          requestedOwner.current !== owner ||
          controllerRef.current !== controller;
        if (!controller || !controller.snapshot().ready)
          throw new Error('Подождите, открываем гардероб.');
        if (accountChanged())
          throw new DOMException('Аккаунт изменился. Выберите вещи снова.', 'AbortError');
        let summary;
        await controller.update((next) => {
          if (accountChanged())
            throw new DOMException('Аккаунт изменился. Выберите вещи снова.', 'AbortError');
          summary = applyItemBatch(next, ids, action);
        });
        if (accountChanged()) throw new DOMException('Аккаунт изменился.', 'AbortError');
        const messages = {
          favorite: 'Выбранные вещи добавлены в избранное',
          unfavorite: 'Выбранные вещи убраны из избранного',
          laundry: 'Выбранные вещи отправлены в стирку',
          available: 'Выбранные вещи готовы к выходу',
          delete: 'Выбранные вещи удалены. История и сохранённые образы сохранены',
        };
        notify(
          (summary.changedCount ? messages[action] : 'Выбранные вещи уже имеют это состояние') +
            (controller.snapshot().storageMode === 'memory' ? ' — до закрытия вкладки' : ''),
        );
        return summary;
      },
      removeItem: (id) =>
        updateState((next) => {
          next.items = next.items.filter((item) => item.id !== id);
          next.shoppingList = next.shoppingList.map((item) =>
            item.itemId === id ? { ...item, itemId: '' } : item,
          );
        }, 'Вещь удалена. Состав сохранённых образов можно проверить в разделе «Образы».'),
      toggleItem: (id, key) =>
        updateState((next) => {
          if (!['favorite', 'available'].includes(key))
            throw new Error('Недопустимое действие с вещью.');
          const item = next.items.find((value) => value.id === id);
          if (!item) throw new Error('Вещь не найдена.');
          item[key] = !item[key];
        }),
      saveOutfit: (draft) =>
        updateState(
          (next) => {
            putOutfit(next, draft);
          },
          draft.id ? 'Образ обновлён' : 'Образ сохранён',
        ),
      removeOutfit: (id) =>
        updateState((next) => {
          next.outfits = next.outfits.filter((outfit) => outfit.id !== id);
          next.plans = next.plans.filter((plan) => plan.outfitId !== id);
        }, 'Образ удалён'),
      toggleOutfit: (id) =>
        updateState((next) => {
          const outfit = next.outfits.find((value) => value.id === id);
          if (!outfit) throw new Error('Образ не найден.');
          outfit.favorite = !outfit.favorite;
        }),
      savePlan: (draft) =>
        updateState((next) => {
          putPlan(next, draft);
        }, 'План сохранён'),
      removePlan: (id) =>
        updateState((next) => {
          next.plans = next.plans.filter((plan) => plan.id !== id);
        }, 'План удалён'),
      saveShopping: (draft) =>
        updateState(
          (next) => {
            putShopping(next, draft);
          },
          draft.id ? 'Покупка обновлена' : 'Покупка добавлена',
        ),
      removeShopping: (id) =>
        updateState((next) => {
          next.shoppingList = next.shoppingList.filter((item) => item.id !== id);
        }, 'Покупка удалена'),
      purchaseShopping: (id) =>
        updateState((next) => {
          const shopping = next.shoppingList.find((item) => item.id === id);
          if (!shopping) throw new Error('Покупка не найдена.');
          shopping.status = 'purchased';
        }, 'Покупка отмечена'),
      saveProfile: (profile) =>
        updateState((next) => {
          next.profile = {
            ...next.profile,
            ...profile,
            ...(profile.city !== undefined &&
            profile.city !== next.profile.city &&
            profile.location === undefined
              ? { location: null }
              : {}),
          };
        }, 'Профиль сохранён'),
      loadDemo: () => updateState((next) => demoState(next), 'Учебные примеры добавлены'),
      importBackup: async (file, { beforeApply } = {}) => {
        if (!file) throw new Error('Выберите резервную копию.');
        if (file.size > MAX_BACKUP_FILE_BYTES)
          throw new Error(
            `Файл слишком большой. Максимум — ${MAX_BACKUP_FILE_BYTES / 1024 / 1024} МиБ.`,
          );
        let parsed;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error('Не удалось прочитать JSON. Выберите резервную копию MyCloset.');
        }
        const imported = validateState(parsed);
        if (beforeApply) await beforeApply();
        return updateState(() => imported, 'Резервная копия загружена');
      },
      exportBackup: () => {
        const snapshot = controllerRef.current?.snapshot();
        if (!snapshot?.ready) throw new Error('Гардероб ещё открывается.');
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(snapshot.state, null, 2)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `MyCloset-backup-${localDate()}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('Резервная копия подготовлена к скачиванию.');
      },
      resetData: async () => {
        const controller = controllerRef.current;
        if (!controller) throw new Error('Подождите, открываем гардероб.');
        await controller.reset();
        notify(
          'Все данные удалены' +
            (controller.snapshot().storageMode === 'memory' ? ' из текущей вкладки' : ''),
        );
      },
    }),
    [updateState, notify, loadWeather, switchOwner, readGuestWardrobe],
  );

  return (
    <ClosetContext.Provider value={{ ...view, ...actions, weather, weatherLoading, weatherError }}>
      {children}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </ClosetContext.Provider>
  );
}

export function useCloset() {
  const value = useContext(ClosetContext);
  if (!value) throw new Error('useCloset должен использоваться внутри ClosetProvider.');
  return value;
}
