import { validateState } from '../data/model.js';

export const CLOUD_CONNECTION_PREFIX = 'mycloset:cloud-connection:v1:';
export const CLOUD_OWNER_KEY = 'mycloset:cloud-owner:v1';
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isTimestamp = (value) =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export function cloudRequiresHttps(location, secureContext) {
  const hostname = String(location?.hostname || '').toLowerCase();
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1';
  return location?.protocol === 'http:' && secureContext === false && !loopback;
}

/** JSONB may reorder object keys. Array order is intentional wardrobe data. */
export function canonicalSnapshotJson(snapshot) {
  return JSON.stringify(snapshot, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    );
  });
}

export async function hashSnapshot(snapshot) {
  const bytes = new TextEncoder().encode(canonicalSnapshotJson(snapshot));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }
  // Web Crypto is unavailable on a phone opening a LAN HTTP address.
  const { sha256 } = await import('@noble/hashes/sha2.js');
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function planCloudSync(connection, remote, localHash) {
  if (!connection?.connected) return 'disconnected';
  if (remote.snapshot !== null && remote.hash === localHash) return 'acknowledge';
  if (remote.snapshot === null || remote.revision < connection.revision) return 'conflict';
  const localChanged = localHash !== connection.lastHash;
  const remoteChanged = remote.revision !== connection.revision;
  if (localChanged && remoteChanged) return 'conflict';
  if (remoteChanged) return 'download';
  if (localChanged) return 'upload';
  return 'idle';
}

export function readCloudConnection(storage, userId) {
  try {
    if (!userId || storage?.getItem(CLOUD_OWNER_KEY) !== userId) return null;
    const raw = storage.getItem(CLOUD_CONNECTION_PREFIX + encodeURIComponent(userId));
    if (!raw || raw.length > 1024) return null;
    const value = JSON.parse(raw);
    if (
      !value ||
      value.userId !== userId ||
      value.connected !== true ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      !isHash(value.lastHash)
    )
      return null;
    return { userId, connected: true, revision: value.revision, lastHash: value.lastHash };
  } catch {
    return null;
  }
}

export function writeCloudConnection(storage, connection) {
  try {
    const { userId, connected, revision, lastHash } = connection;
    if (
      !userId ||
      typeof connected !== 'boolean' ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !isHash(lastHash)
    )
      return false;
    storage.setItem(
      CLOUD_CONNECTION_PREFIX + encodeURIComponent(userId),
      JSON.stringify({ userId, connected, revision, lastHash }),
    );
    if (connected) storage.setItem(CLOUD_OWNER_KEY, userId);
    else if (storage.getItem(CLOUD_OWNER_KEY) === userId) storage.removeItem(CLOUD_OWNER_KEY);
    return true;
  } catch {
    return false;
  }
}

export class CloudSyncError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'CloudSyncError';
    this.status = status;
    this.code = code;
  }
}

/** Neon normalizes Better Auth errors to lowercase AuthApiError codes. */
export function authErrorMessage(error) {
  const aliases = {
    invalid_credentials: 'INVALID_EMAIL_OR_PASSWORD',
    user_not_found: 'INVALID_EMAIL_OR_PASSWORD',
    email_exists: 'USER_ALREADY_EXISTS',
    user_already_exists: 'USER_ALREADY_EXISTS',
    email_not_confirmed: 'EMAIL_NOT_VERIFIED',
    weak_password: 'PASSWORD_TOO_SHORT',
    over_request_rate_limit: 'TOO_MANY_REQUESTS',
    over_email_send_rate_limit: 'TOO_MANY_REQUESTS',
    invalid_grant: 'INVALID_TOKEN',
    bad_jwt: 'INVALID_TOKEN',
  };
  const messages = {
    INVALID_EMAIL_OR_PASSWORD: 'Неверная почта или пароль.',
    EMAIL_NOT_VERIFIED: 'Подтвердите почту кодом из письма, затем войдите.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
      'Аккаунт с такой почтой уже существует. Войдите или восстановите пароль.',
    USER_ALREADY_EXISTS: 'Аккаунт с такой почтой уже существует. Войдите или восстановите пароль.',
    PASSWORD_TOO_SHORT: 'Пароль должен содержать не менее 8 символов.',
    PASSWORD_TOO_LONG: 'Пароль должен содержать не более 128 символов.',
    INVALID_TOKEN: 'Ссылка недействительна или устарела. Запросите новое письмо.',
    OTP_EXPIRED: 'Код устарел. Запросите новый код.',
    INVALID_OTP: 'Неверный код подтверждения.',
    TOO_MANY_REQUESTS: 'Слишком много попыток. Попробуйте немного позже.',
    email_address_invalid: 'Укажите корректную электронную почту.',
    validation_failed: 'Проверьте данные формы и требования к паролю.',
    feature_not_supported: 'Это действие пока недоступно в сервисе аккаунтов.',
  };
  return (
    messages[aliases[error?.code] || error?.code] ||
    (error?.status === 429
      ? messages.TOO_MANY_REQUESTS
      : 'Не удалось выполнить действие с аккаунтом. Проверьте подключение и повторите попытку.')
  );
}

async function requestJson(
  path,
  { userId, signal, method = 'GET', body, fetcher = globalThis.fetch } = {},
) {
  let response;
  try {
    response = await fetcher(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        ...(userId ? { 'X-MyCloset-Account': userId } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new CloudSyncError('Нет связи с облаком. Изменения остаются на этом устройстве.');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new CloudSyncError(
      'Сервер вернул нечитаемый ответ. Локальный гардероб сохранён.',
      response.status,
    );
  }
  if (!response.ok) {
    const messages = {
      401: 'Войдите в аккаунт заново. Локальные данные сохранены.',
      409:
        result.code === 'ACCOUNT_CHANGED'
          ? 'Аккаунт изменился в другой вкладке. Подключите синхронизацию заново.'
          : 'В облаке уже есть изменения. Выберите, какой гардероб сохранить.',
      413: 'Облачная копия превышает допустимый размер. Скачайте резервную копию и уменьшите фотографии.',
      429: 'Слишком много запросов. Попробуйте немного позже.',
      503: 'Облако временно недоступно. Локальные изменения сохраняются.',
    };
    throw new CloudSyncError(
      messages[response.status] || 'Не удалось связаться с облаком. Повторите попытку позже.',
      response.status,
      result.code || '',
    );
  }
  return result;
}

export async function fetchCloudStatus(options) {
  const result = await requestJson('/api/cloud/status', options);
  if (typeof result.configured !== 'boolean')
    throw new CloudSyncError('Не удалось определить доступность облака.');
  return result;
}

export async function fetchCloudWardrobe(options) {
  const known = options?.knownRevision;
  const path =
    '/api/cloud/wardrobe' + (Number.isSafeInteger(known) && known >= 0 ? `?revision=${known}` : '');
  const result = await requestJson(path, options);
  if (
    !Number.isSafeInteger(result.revision) ||
    result.revision < 0 ||
    (result.updatedAt !== null && !isTimestamp(result.updatedAt))
  ) {
    throw new CloudSyncError('Облачная копия имеет некорректные данные синхронизации.');
  }
  if (result.notModified === true) {
    if (result.revision !== known || !isHash(result.hash) || !isTimestamp(result.updatedAt))
      throw new CloudSyncError('Не удалось проверить версию облачного гардероба.');
    return {
      notModified: true,
      revision: result.revision,
      hash: result.hash,
      updatedAt: result.updatedAt,
    };
  }
  if (result.snapshot === null) {
    if (result.revision !== 0)
      throw new CloudSyncError('Облачная копия не найдена. Подключите синхронизацию заново.');
    return { snapshot: null, revision: 0, hash: '', updatedAt: null };
  }
  if (result.revision < 1) throw new CloudSyncError('Некорректная версия облачной копии.');
  const snapshot = validateState(result.snapshot);
  const hash = await hashSnapshot(snapshot);
  if (!isHash(result.hash) || result.hash !== hash)
    throw new CloudSyncError(
      'Не удалось проверить целостность облачной копии. Локальные данные не изменены.',
    );
  return { snapshot, revision: result.revision, hash, updatedAt: result.updatedAt };
}

export async function uploadCloudWardrobe(snapshot, revision, options) {
  const hash = await hashSnapshot(snapshot);
  const result = await requestJson('/api/cloud/wardrobe', {
    ...options,
    method: 'POST',
    body: { revision, snapshot },
  });
  if (
    !Number.isSafeInteger(result.revision) ||
    result.revision <= revision ||
    !isHash(result.hash) ||
    result.hash !== hash ||
    !isTimestamp(result.updatedAt)
  ) {
    throw new CloudSyncError(
      'Не удалось подтвердить сохранение облачной копии. Проверьте состояние синхронизации.',
    );
  }
  return { snapshot, revision: result.revision, hash, updatedAt: result.updatedAt };
}

export function wardrobeSummary(snapshot) {
  if (!snapshot) return 'Облачной копии пока нет.';
  return `Вещей: ${snapshot.items.length}, образов: ${snapshot.outfits.length}, планов: ${snapshot.plans.length}, покупок: ${snapshot.shoppingList.length}. Отметок носки: ${snapshot.wearLog.length}, капсул: ${snapshot.capsules.length}, поездок: ${snapshot.trips.length}.`;
}
