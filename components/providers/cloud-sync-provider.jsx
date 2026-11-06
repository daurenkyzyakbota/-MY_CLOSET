'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import {
  CLOUD_CONNECTION_PREFIX,
  CLOUD_OWNER_KEY,
  CloudSyncError,
  fetchCloudStatus,
  fetchCloudWardrobe,
  uploadCloudWardrobe,
  hashSnapshot,
  planCloudSync,
  readCloudConnection,
  writeCloudConnection,
  authErrorMessage,
  cloudRequiresHttps,
} from '@/lib/cloud/cloud-sync-client.js';

const CloudSyncContext = createContext(null);
const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const aborted = () => new DOMException('Операция отменена.', 'AbortError');
function requireSecureOrigin() {
  if (cloudRequiresHttps(window.location, window.isSecureContext))
    throw new CloudSyncError(
      'Для входа с телефона нужна HTTPS-ссылка; здесь можно работать с локальным гардеробом без аккаунта.',
    );
}

function authFailure(error) {
  const failure = new Error(authErrorMessage(error));
  failure.code = error?.code || '';
  return failure;
}
async function checkedAuth(operation) {
  let result;
  try {
    result = await operation;
  } catch (error) {
    throw authFailure(error);
  }
  if (result?.error) throw authFailure(result.error);
  return result?.data;
}

export function CloudSyncProvider({ children }) {
  const closet = useCloset();
  const authClientRef = useRef(null);
  const sessionRequest = useRef(0);
  const [session, setSession] = useState({ data: null, isPending: true, error: null });
  const refetchSession = useCallback(async () => {
    if (cloudRequiresHttps(window.location, window.isSecureContext)) return null;
    const request = ++sessionRequest.current;
    try {
      // A direct same-origin read avoids the SDK's 60-second browser cache when
      // another tab changes the HTTP-only session cookie.
      const response = await fetch('/api/auth/get-session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('Не удалось проверить вход в аккаунт.');
      const value = await response.json();
      const data = value?.user && value?.session ? value : null;
      if (request === sessionRequest.current) setSession({ data, isPending: false, error: null });
      return data;
    } catch (cause) {
      if (request === sessionRequest.current)
        setSession((current) => ({ ...current, isPending: false, error: cause }));
      return null;
    }
  }, []);
  const authSession = { ...session, refetch: refetchSession };
  const user = authSession.data?.user || null;
  const userId = user?.id || '';
  const latest = useRef({ closet, userId, refetchSession: authSession.refetch });
  latest.current = { closet, userId, refetchSession: authSession.refetch };
  const generation = useRef(0);
  const owner = useRef(undefined);
  const flight = useRef(null);
  const connectionRef = useRef(null);
  const remoteRef = useRef(null);
  const statusRef = useRef('disconnected');
  const [configured, setConfigured] = useState(null);
  const [configError, setConfigError] = useState('');
  const [connection, setConnection] = useState(null);
  const [remote, setRemote] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remembered, setRemembered] = useState(true);
  const [online, setOnline] = useState(true);
  const [requiresHttps, setRequiresHttps] = useState(false);

  const changeStatus = useCallback((value, message = '') => {
    statusRef.current = value;
    setStatus(value);
    setError(message);
  }, []);
  const showRemote = useCallback((value) => {
    const previous = remoteRef.current;
    const next =
      value?.notModified && previous?.revision === value.revision
        ? { ...previous, ...value }
        : value;
    remoteRef.current = next;
    setRemote(next);
  }, []);
  const forget = useCallback((id) => {
    const storage = browserStorage();
    try {
      if (id) storage?.removeItem(CLOUD_CONNECTION_PREFIX + encodeURIComponent(id));
      if (storage?.getItem(CLOUD_OWNER_KEY) === id) storage.removeItem(CLOUD_OWNER_KEY);
    } catch {
      /* A disabled browser preference store must not prevent sign-out. */
    }
  }, []);
  const stop = useCallback(
    (message = '') => {
      generation.current += 1;
      const previous = flight.current;
      previous?.controller.abort();
      flight.current = null;
      if (connectionRef.current) forget(connectionRef.current.userId);
      connectionRef.current = null;
      setConnection(null);
      setBusy(false);
      changeStatus('disconnected', message);
      return previous?.promise;
    },
    [changeStatus, forget],
  );

  useEffect(() => {
    let alive = true;
    const insecure = cloudRequiresHttps(window.location, window.isSecureContext);
    setRequiresHttps(insecure);
    if (insecure) setSession({ data: null, isPending: false, error: null });
    else {
      // The SDK evaluates crypto.randomUUID at module load. Importing it on an
      // insecure LAN HTTP origin would otherwise break the local-only app too.
      void import('@neondatabase/auth/next')
        .then(({ createAuthClient }) => {
          if (!alive) return;
          authClientRef.current = createAuthClient();
          return refetchSession();
        })
        .catch((cause) => {
          if (alive) setSession({ data: null, isPending: false, error: cause });
        });
    }
    const controller = new AbortController();
    fetchCloudStatus({ signal: controller.signal })
      .then((result) => setConfigured(result.configured))
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setConfigured(false);
          setConfigError(cause.message);
        }
      });
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      alive = false;
      sessionRequest.current += 1;
      controller.abort();
      generation.current += 1;
      flight.current?.controller.abort();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [refetchSession]);

  const commitConnection = useCallback(
    (record, id) => {
      const value = {
        userId: id,
        connected: true,
        revision: record.revision,
        lastHash: record.hash,
      };
      connectionRef.current = value;
      setConnection(value);
      setRemembered(writeCloudConnection(browserStorage(), value));
      showRemote(record);
      changeStatus('ready');
    },
    [changeStatus, showRemote],
  );

  const runJob = useCallback(
    async (work) => {
      requireSecureOrigin();
      const id = latest.current.userId;
      if (
        !id ||
        !latest.current.closet.ready ||
        latest.current.closet.ownerId !== id ||
        configured !== true
      )
        throw new CloudSyncError('Войдите в аккаунт и дождитесь открытия гардероба.');
      if (flight.current) throw new CloudSyncError('Дождитесь завершения текущей синхронизации.');
      if (!navigator.onLine) {
        changeStatus('offline', 'Нет подключения. Изменения остаются на этом устройстве.');
        throw new CloudSyncError('Нет подключения к интернету.');
      }
      const controller = new AbortController();
      const token = generation.current;
      const previousStatus = statusRef.current;
      const isCurrent = () =>
        token === generation.current && latest.current.userId === id && !controller.signal.aborted;
      const assertCurrent = () => {
        if (!isCurrent()) throw aborted();
      };
      const context = {
        id,
        token,
        previousStatus,
        isCurrent,
        assertCurrent,
        options: { userId: id, signal: controller.signal },
      };
      const current = { controller, promise: null };
      flight.current = current;
      setBusy(true);
      changeStatus('syncing');
      const timeout = setTimeout(() => controller.abort(), 60000);
      current.promise = (async () => {
        try {
          const result = await work(context);
          assertCurrent();
          if (statusRef.current === 'syncing')
            changeStatus(connectionRef.current ? 'ready' : 'disconnected');
          return result;
        } catch (cause) {
          if (!isCurrent()) {
            if (token === generation.current && latest.current.userId === id)
              changeStatus(
                'error',
                'Операция заняла слишком много времени. Локальные данные сохранены; повторите попытку.',
              );
            throw cause;
          }
          if (cause.status === 401 || cause.code === 'ACCOUNT_CHANGED') {
            stop(cause.message);
            void latest.current.refetchSession();
          } else if (cause.status === 409) {
            try {
              const fresh = await fetchCloudWardrobe(context.options);
              assertCurrent();
              showRemote(fresh);
            } catch {
              /* Keep the previous verified cloud snapshot available. */
            }
            changeStatus('conflict', cause.message);
          } else
            changeStatus(
              navigator.onLine ? 'error' : 'offline',
              cause.message || 'Не удалось синхронизировать гардероб.',
            );
          throw cause;
        } finally {
          clearTimeout(timeout);
          if (flight.current === current) {
            flight.current = null;
            setBusy(false);
          }
        }
      })();
      return current.promise;
    },
    [configured, changeStatus, showRemote, stop],
  );

  const fetchRemote = useCallback(
    async (context, options = {}) => {
      const value = await fetchCloudWardrobe({ ...context.options, ...options });
      context.assertCurrent();
      showRemote(value);
      return value;
    },
    [showRemote],
  );
  const refreshRemote = useCallback(
    () =>
      runJob(async (context) => {
        const value = await fetchRemote(context);
        if (context.previousStatus === 'conflict') changeStatus('conflict');
        return value;
      }),
    [runJob, fetchRemote, changeStatus],
  );

  const applyRemote = useCallback(async (record, expectedHash, context) => {
    if (!record.snapshot) throw new CloudSyncError('В этом аккаунте пока нет облачной копии.');
    context.assertCurrent();
    await latest.current.closet.updateState(async (current) => {
      context.assertCurrent();
      if ((await hashSnapshot(current)) !== expectedHash)
        throw new CloudSyncError(
          'Локальный гардероб изменился во время загрузки. Выберите копию ещё раз.',
          409,
          'LOCAL_CHANGED',
        );
      context.assertCurrent();
      return record.snapshot;
    });
    context.assertCurrent();
  }, []);

  const connectLocal = useCallback(
    (expectedRevision) =>
      runJob(async (context) => {
        const current = await fetchRemote(context);
        if (current.revision !== expectedRevision)
          throw new CloudSyncError(
            'Облачная копия изменилась после подтверждения. Проверьте её состав и повторите выбор.',
            409,
          );
        const snapshot = latest.current.closet.state;
        const saved = await uploadCloudWardrobe(snapshot, current.revision, context.options);
        context.assertCurrent();
        commitConnection(saved, context.id);
        latest.current.closet.notify('Гардероб сохранён в облаке. Синхронизация подключена.');
        return saved;
      }),
    [runJob, fetchRemote, commitConnection],
  );

  const connectCloud = useCallback(
    (expectedRevision) =>
      runJob(async (context) => {
        const current = await fetchRemote(context);
        if (current.revision !== expectedRevision)
          throw new CloudSyncError(
            'Облачная копия изменилась после подтверждения. Проверьте её состав и повторите выбор.',
            409,
          );
        const hash = await hashSnapshot(latest.current.closet.state);
        await applyRemote(current, hash, context);
        commitConnection(current, context.id);
        latest.current.closet.notify('Облачный гардероб открыт на этом устройстве.');
        return current;
      }),
    [runJob, fetchRemote, applyRemote, commitConnection],
  );

  const syncNow = useCallback(() => {
    if (!connectionRef.current || flight.current || statusRef.current === 'conflict')
      return Promise.resolve(null);
    return runJob(async (context) => {
      const base = connectionRef.current;
      const snapshot = latest.current.closet.state;
      const localHash = await hashSnapshot(snapshot);
      context.assertCurrent();
      const current = await fetchRemote(context, { knownRevision: base.revision });
      const action = planCloudSync(base, current, localHash);
      if (action === 'conflict') {
        changeStatus(
          'conflict',
          'Гардероб изменился и здесь, и на другом устройстве. Автоматическая синхронизация приостановлена. Выберите, какую копию сохранить.',
        );
      } else if (action === 'download') {
        await applyRemote(current, localHash, context);
        commitConnection(current, context.id);
      } else if (action === 'upload') {
        const saved = await uploadCloudWardrobe(snapshot, base.revision, context.options);
        context.assertCurrent();
        commitConnection(saved, context.id);
      } else if (action === 'acknowledge') commitConnection(current, context.id);
      else changeStatus('ready');
      return current;
    });
  }, [runJob, fetchRemote, applyRemote, commitConnection, changeStatus]);

  useEffect(() => {
    if (authSession.isPending || closet.ownerId === userId) return;
    const pending = stop();
    void Promise.resolve(pending)
      .catch(() => {})
      .then(() => closet.switchOwner(userId));
  }, [authSession.isPending, userId, closet.ownerId, closet.switchOwner, stop]);

  useEffect(() => {
    if (!closet.ready || authSession.isPending || configured !== true) return;
    if (closet.ownerId !== userId) return;
    if (owner.current === userId) return;
    const previous = owner.current;
    stop();
    showRemote(null);
    if (previous !== undefined) {
      forget(previous);
      forget(userId);
    }
    owner.current = userId;
    // An unreadable IndexedDB may expose an empty memory fallback. It must never
    // silently replace a previously connected cloud wardrobe on reload.
    const restored =
      previous === undefined &&
      closet.scopeHasState &&
      closet.storageMode === 'persistent' &&
      !requiresHttps
        ? readCloudConnection(browserStorage(), userId)
        : null;
    if (closet.storageMode !== 'persistent') forget(userId);
    connectionRef.current = restored;
    setConnection(restored);
    if (restored) changeStatus('ready');
    if (userId && !requiresHttps)
      void refreshRemote()
        .then(() => {
          if (connectionRef.current) void syncNow().catch(() => {});
        })
        .catch(() => {});
  }, [
    userId,
    authSession.isPending,
    closet.ready,
    closet.storageMode,
    closet.ownerId,
    closet.scopeHasState,
    requiresHttps,
    configured,
    stop,
    forget,
    showRemote,
    changeStatus,
    refreshRemote,
    syncNow,
  ]);

  useEffect(() => {
    if (!connection?.connected || !closet.ready || !userId || !online || busy) return;
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible' || statusRef.current === 'conflict') return;
      void hashSnapshot(latest.current.closet.state)
        .then((hash) => {
          if (connectionRef.current && hash !== connectionRef.current.lastHash) return syncNow();
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    closet.state,
    closet.ready,
    userId,
    online,
    busy,
    connection?.connected,
    connection?.revision,
    connection?.lastHash,
    syncNow,
  ]);

  useEffect(() => {
    const synchronize = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        !cloudRequiresHttps(window.location, window.isSecureContext)
      ) {
        void refetchSession().then(() => {
          if (connectionRef.current) void syncNow().catch(() => {});
        });
      }
    };
    const storageChanged = (event) => {
      if (
        event.key === CLOUD_OWNER_KEY &&
        event.newValue !== latest.current.userId &&
        connectionRef.current
      )
        stop(
          'В другой вкладке изменилось подключение к аккаунту. Подключите синхронизацию здесь заново.',
        );
    };
    const timer = setInterval(synchronize, 30000);
    document.addEventListener('visibilitychange', synchronize);
    window.addEventListener('online', synchronize);
    window.addEventListener('focus', synchronize);
    window.addEventListener('storage', storageChanged);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', synchronize);
      window.removeEventListener('online', synchronize);
      window.removeEventListener('focus', synchronize);
      window.removeEventListener('storage', storageChanged);
    };
  }, [syncNow, stop, refetchSession]);

  function auth() {
    requireSecureOrigin();
    if (!authClientRef.current)
      throw new CloudSyncError(
        'Сервис входа ещё не загрузился. Обновите страницу или продолжайте работать с локальным гардеробом.',
      );
    return authClientRef.current;
  }

  async function signIn({ email, password }) {
    await checkedAuth(auth().signIn.email({ email, password }));
    await authSession.refetch();
  }
  async function signUp({ name, email, password }) {
    const result = await checkedAuth(auth().signUp.email({ name, email, password }));
    await authSession.refetch();
    return { needsVerification: !result?.token && !result?.session };
  }
  async function signOut() {
    const pending = stop();
    forget(latest.current.userId);
    await pending?.catch(() => {});
    await checkedAuth(auth().signOut());
    await authSession.refetch();
  }
  async function requestPasswordReset(email) {
    await checkedAuth(
      auth().requestPasswordReset({ email, redirectTo: `${window.location.origin}/account` }),
    );
  }
  async function resetPassword(token, newPassword) {
    await checkedAuth(auth().resetPassword({ token, newPassword }));
    await authSession.refetch();
  }
  async function sendVerificationCode(email) {
    await checkedAuth(auth().emailOtp.sendVerificationOtp({ email, type: 'email-verification' }));
  }
  async function verifyEmailCode(email, otp) {
    await checkedAuth(auth().emailOtp.verifyEmail({ email, otp }));
    await authSession.refetch();
  }

  return (
    <CloudSyncContext.Provider
      value={{
        user,
        sessionLoading: authSession.isPending,
        authError: authSession.error
          ? 'Не удалось проверить вход в аккаунт. Проверьте подключение и повторите попытку.'
          : '',
        configured,
        configError,
        connection,
        connected: !!connection?.connected,
        remote,
        status: online ? status : connection ? 'offline' : status,
        error,
        busy,
        remembered,
        online,
        requiresHttps,
        signIn,
        signUp,
        signOut,
        requestPasswordReset,
        resetPassword,
        sendVerificationCode,
        verifyEmailCode,
        refreshSession: () => authSession.refetch(),
        refreshRemote,
        connectLocal,
        connectCloud,
        syncNow,
        disconnect: () =>
          stop('Синхронизация отключена. Локальный и облачный гардеробы сохранены отдельно.'),
      }}
    >
      {children}
    </CloudSyncContext.Provider>
  );
}

export function useCloudSync() {
  const value = useContext(CloudSyncContext);
  if (!value) throw new Error('useCloudSync должен использоваться внутри CloudSyncProvider.');
  return value;
}
