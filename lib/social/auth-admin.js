// Optional server-side deletion adapter. Activating it requires a separately approved
// Managed Auth service account with the admin role; ordinary credentials cannot
// enable it. The browser's session is never replaced with the service session.
import {
  NEON_AUTH_COOKIE_PREFIX,
  NEON_AUTH_SERVER_PROXY_HEADER,
  parseSetCookies,
} from '@neondatabase/auth/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_LIMIT = 128 * 1024;
const allowedEndpoints = new Set(['sign-in/email', 'admin/remove-user', 'sign-out']);

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function configuration(environment) {
  const email = environment.MYCLOSET_AUTH_ADMIN_EMAIL;
  const password = environment.MYCLOSET_AUTH_ADMIN_PASSWORD;
  let base;
  try {
    base = new URL(environment.NEON_AUTH_BASE_URL);
  } catch {
    throw failure(503, 'AUTH_ADMIN_NOT_CONFIGURED', 'Удаление аккаунта пока не подключено.');
  }
  if (
    base.protocol !== 'https:' ||
    !base.hostname.endsWith('.neon.tech') ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.port && base.port !== '443') ||
    !base.pathname.replace(/\/$/, '').endsWith('/auth') ||
    typeof email !== 'string' ||
    !email.includes('@') ||
    email.length > 254 ||
    typeof password !== 'string' ||
    password.length < 16 ||
    password.length > 128
  )
    throw failure(503, 'AUTH_ADMIN_NOT_CONFIGURED', 'Удаление аккаунта пока не подключено.');
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  return { base, email, password };
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw failure(503, 'AUTH_INVALID_RESPONSE', 'Сервис входа вернул неполный ответ.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) {
        await reader.cancel();
        throw failure(503, 'AUTH_INVALID_RESPONSE', 'Сервис входа вернул неполный ответ.');
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch (error) {
    if (error.code === 'AUTH_INVALID_RESPONSE') throw error;
    throw failure(503, 'AUTH_INVALID_RESPONSE', 'Сервис входа вернул неполный ответ.');
  } finally {
    reader.releaseLock();
  }
}

/** Each operation gets isolated cookies held only in RAM and signs out afterward. */
function privateSession({ base, origin, fetcher, signal }) {
  const cookies = new Map();
  async function call(endpoint, body, requestSignal = signal) {
    if (!allowedEndpoints.has(endpoint)) throw new Error('Unsupported Managed Auth operation.');
    const response = await fetcher(new URL(endpoint, base), {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: origin,
        [NEON_AUTH_SERVER_PROXY_HEADER]: 'nextjs',
        ...(cookies.size
          ? {
              Cookie: [...cookies]
                .map(([name, value]) => name + '=' + encodeURIComponent(value))
                .join('; '),
            }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(10000)]),
    });
    for (const header of response.headers.getSetCookie()) {
      for (const cookie of parseSetCookies(header)) {
        if (!cookie.name.startsWith(NEON_AUTH_COOKIE_PREFIX)) continue;
        if (
          cookie.maxAge === 0 ||
          (cookie.expires && new Date(cookie.expires).getTime() <= Date.now())
        )
          cookies.delete(cookie.name);
        else cookies.set(cookie.name, cookie.value);
      }
    }
    const result = await readJson(response);
    if (!response.ok) {
      const code =
        typeof result?.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(result.code)
          ? result.code
          : 'AUTH_UPSTREAM_ERROR';
      throw failure(response.status, code, 'Сервис входа отклонил запрос.');
    }
    return result;
  }
  return {
    call,
    async close() {
      try {
        if (cookies.size) await call('sign-out', {}, AbortSignal.timeout(2000));
      } catch {
        // A successful identity deletion remains successful if logout times out.
      } finally {
        cookies.clear();
      }
    },
  };
}

export function createManagedAccountDeleter({
  environment = process.env,
  fetcher = globalThis.fetch,
} = {}) {
  return async function deleteVerifiedManagedAccount(input) {
    if (typeof window !== 'undefined')
      throw new Error('Managed account deletion runs on the server.');
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['user', 'password', 'origin'].includes(key)) ||
      typeof input.user?.id !== 'string' ||
      !UUID.test(input.user.id) ||
      typeof input.user?.email !== 'string' ||
      !input.user.email.includes('@') ||
      input.user.email.length > 254 ||
      typeof input.password !== 'string' ||
      input.password.length < 8 ||
      input.password.length > 128
    )
      throw failure(400, 'ACCOUNT_DELETE_INPUT', 'Подтвердите удаление паролем своего аккаунта.');
    const { user, password, origin } = input;
    let originUrl;
    try {
      originUrl = new URL(origin);
    } catch {}
    if (
      !originUrl ||
      !['http:', 'https:'].includes(originUrl.protocol) ||
      originUrl.origin !== origin
    )
      throw failure(400, 'ACCOUNT_DELETE_ORIGIN', 'Откройте форму удаления на сайте.');
    const { base, email, password: servicePassword } = configuration(environment);
    if (user.email.toLocaleLowerCase('en') === email.toLocaleLowerCase('en'))
      throw failure(
        403,
        'SERVICE_ACCOUNT_PROTECTED',
        'Служебную запись нельзя удалить через профиль.',
      );

    const signal = AbortSignal.timeout(25000);
    const proof = privateSession({ base, origin, fetcher, signal });
    const administrator = privateSession({ base, origin, fetcher, signal });
    try {
      let verified;
      try {
        verified = await proof.call('sign-in/email', { email: user.email, password });
      } catch (error) {
        if ([400, 401].includes(error.status))
          throw failure(401, 'INVALID_PASSWORD', 'Пароль не подошёл.');
        if (error.status === 429)
          throw failure(
            429,
            'ACCOUNT_DELETE_RATE_LIMIT',
            'Слишком много попыток. Попробуйте позже.',
          );
        throw failure(
          503,
          'ACCOUNT_REAUTH_UNAVAILABLE',
          'Не удалось подтвердить вход. Повторите попытку позже.',
        );
      }
      if (verified.user?.id !== user.id)
        throw failure(409, 'ACCOUNT_CHANGED', 'Аккаунт изменился. Обновите страницу.');

      let serviceIdentity;
      try {
        serviceIdentity = await administrator.call('sign-in/email', {
          email,
          password: servicePassword,
        });
      } catch {
        throw failure(503, 'AUTH_ADMIN_UNAVAILABLE', 'Удаление аккаунта временно недоступно.');
      }
      if (
        !String(serviceIdentity.user?.role || '')
          .split(',')
          .map((value) => value.trim())
          .includes('admin')
      )
        throw failure(
          503,
          'AUTH_ADMIN_ROLE_REQUIRED',
          'Удаление аккаунта ожидает настройки служебного доступа.',
        );
      if (serviceIdentity.user.id === verified.user.id)
        throw failure(
          403,
          'SERVICE_ACCOUNT_PROTECTED',
          'Служебную запись нельзя удалить через профиль.',
        );

      let result;
      try {
        // The target is the separately verified current identity, never a body targetId.
        result = await administrator.call('admin/remove-user', { userId: verified.user.id });
      } catch {
        throw failure(
          503,
          'ACCOUNT_DELETE_UNCONFIRMED',
          'Сервис входа не подтвердил удаление. Обновите страницу перед повтором.',
        );
      }
      if (result?.success !== true)
        throw failure(
          503,
          'ACCOUNT_DELETE_UNCONFIRMED',
          'Сервис входа не подтвердил удаление. Обновите страницу перед повтором.',
        );
      return { deleted: true };
    } finally {
      await Promise.allSettled([proof.close(), administrator.close()]);
    }
  };
}

export const deleteManagedAccount = createManagedAccountDeleter();
