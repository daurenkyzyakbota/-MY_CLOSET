export class NotificationError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function onlyFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key)))
    throw new NotificationError('Проверьте настройки уведомлений.');
  return value;
}

export function notificationPreferences(value) {
  onlyFields(value, ['messages', 'outfits', 'timeZone', 'reminderHour']);
  if (typeof value.messages !== 'boolean' || typeof value.outfits !== 'boolean' ||
    !Number.isInteger(value.reminderHour) || value.reminderHour < 0 || value.reminderHour > 23 ||
    typeof value.timeZone !== 'string' || !/^[A-Za-z0-9_+/-]{1,80}$/.test(value.timeZone))
    throw new NotificationError('Выберите события, час и часовой пояс.');
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(); }
  catch { throw new NotificationError('Укажите действительный часовой пояс.'); }
  return value;
}

export function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048)
    throw new NotificationError('Неверный адрес подписки браузера.');
  let url;
  try { url = new URL(value); } catch { throw new NotificationError('Неверный адрес подписки браузера.'); }
  const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  const allowed = hosts.includes(url.hostname) || url.hostname.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.port || url.hash)
    throw new NotificationError('Этот сервис уведомлений браузера не поддерживается.');
  return url.href;
}

function decodeKey(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100)
    throw new NotificationError('Неверные ключи подписки браузера.');
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)); }
  catch { throw new NotificationError('Неверные ключи подписки браузера.'); }
  if (bytes.length !== length) throw new NotificationError('Неверные ключи подписки браузера.');
  return bytes;
}

export async function pushSubscription(value, now = Date.now()) {
  onlyFields(value, ['endpoint', 'keys', 'expirationTime']);
  onlyFields(value.keys, ['p256dh', 'auth']);
  const endpoint = pushEndpoint(value.endpoint);
  const publicKey = decodeKey(value.keys.p256dh, 65);
  decodeKey(value.keys.auth, 16);
  try {
    await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch { throw new NotificationError('Неверные ключи подписки браузера.'); }
  const expirationTime = value.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime <= now || expirationTime > now + 10 * 366 * 86400_000))
    throw new NotificationError('Подписка браузера истекла. Включите уведомления заново.');
  return { endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth }, expirationTime };
}

export function genericPush(kind, target) {
  if (kind === 'message') return {
    title: 'MyCloset', body: 'У вас новое сообщение.',
    url: '/messages?' + new URLSearchParams({ conversation: target.conversationId }),
    tag: 'mycloset-message-' + target.messageId,
  };
  return {
    title: 'MyCloset', body: 'На завтра запланирован образ. Загляните в календарь.',
    url: '/calendar?' + new URLSearchParams({ date: target.date }),
    tag: 'mycloset-outfit-' + target.date,
  };
}
