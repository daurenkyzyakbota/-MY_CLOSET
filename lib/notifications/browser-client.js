const OWNER_KEY = 'mycloset:push-owner:v1';
const SCRIPT = '/mycloset-push.js';

export function browserPushSupport() {
  return typeof window !== 'undefined' && window.isSecureContext &&
    'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
}

export async function notificationRequest(path, userId, { method = 'GET', body, signal } = {}) {
  const response = await fetch('/api/notifications/' + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-MyCloset-Account': userId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось обновить уведомления.');
  return result;
}

async function pushRegistration() {
  if (!browserPushSupport()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const worker = registration?.active || registration?.waiting || registration?.installing;
  return worker && new URL(worker.scriptURL).pathname === SCRIPT ? registration : null;
}

export async function browserNotificationEnabled(userId) {
  try {
    if (localStorage.getItem(OWNER_KEY) !== userId) return false;
    const registration = await pushRegistration();
    return !!(await registration?.pushManager.getSubscription());
  } catch { return false; }
}

export async function enableBrowserNotifications(userId, publicKey, { isCurrent = () => true } = {}) {
  if (!browserPushSupport()) throw new Error('Для уведомлений нужен поддерживаемый браузер и HTTPS.');
  const assertCurrent = () => {
    if (!isCurrent()) throw new DOMException('Аккаунт изменился.', 'AbortError');
  };
  assertCurrent();
  // Called only from the visible button. No mount, login or polling path asks permission.
  const permission = Notification.permission === 'granted'
    ? 'granted' : await Notification.requestPermission();
  assertCurrent();
  if (permission !== 'granted') throw new Error('Разрешите уведомления в настройках браузера, затем попробуйте снова.');
  await navigator.serviceWorker.register(SCRIPT, { scope: '/', updateViaCache: 'none' });
  const ready = await navigator.serviceWorker.ready;
  assertCurrent();
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (value) => value.charCodeAt(0));
  const subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    assertCurrent();
    const result = await notificationRequest('subscriptions', userId, { method: 'POST', body: subscription.toJSON() });
    assertCurrent();
    try { localStorage.setItem(OWNER_KEY, userId); } catch { /* Server ownership is still authoritative. */ }
    return result;
  } catch (error) {
    await subscription.unsubscribe().catch(() => {});
    throw error;
  }
}

/** Stop this browser on logout without asking notification permission or blocking logout offline. */
export async function disconnectBrowserNotifications(userId) {
  let timer;
  const work = (async () => {
    const belongsToAnotherAccount = () => {
      try {
        const owner = localStorage.getItem(OWNER_KEY);
        return !!owner && owner !== userId;
      } catch { return false; }
    };
    if (belongsToAnotherAccount()) return;
    const registration = await pushRegistration().catch(() => null);
    const subscription = await registration?.pushManager.getSubscription().catch(() => null);
    if (belongsToAnotherAccount()) return;
    try { localStorage.removeItem(OWNER_KEY); } catch { /* The browser may block preferences. */ }
    if (!subscription) return;
    await Promise.allSettled([
      subscription.unsubscribe(),
      userId ? notificationRequest('subscriptions', userId, {
        method: 'DELETE', body: { endpoint: subscription.endpoint }, signal: AbortSignal.timeout(2500),
      }) : Promise.resolve(),
    ]);
  })();
  try { await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, 3000); })]); }
  finally { clearTimeout(timer); }
}
