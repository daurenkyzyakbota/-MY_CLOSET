import { sameAuthOrigin } from './auth-handlers.js';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const MAX_BODY_BYTES = 2048;
const reply = (body, status = 200) => Response.json(body, { status, headers: PRIVATE_HEADERS });

class AccountRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateAccountNamePatch(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'name') ||
    typeof body.name !== 'string'
  )
    throw new AccountRequestError('Можно изменить только имя аккаунта.', 400, 'INVALID_ACCOUNT_PATCH');
  const name = body.name.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name))
    throw new AccountRequestError('Введите имя от 1 до 80 символов без переноса строки.', 400, 'INVALID_NAME');
  return { name };
}

async function readPatch(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    throw new AccountRequestError('Нужен запрос JSON.', 415, 'INVALID_CONTENT_TYPE');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))
    throw new AccountRequestError('Слишком много данных аккаунта.', 413, 'TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new AccountRequestError('Нет данных аккаунта.', 400, 'INVALID_ACCOUNT_PATCH');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AccountRequestError('Слишком много данных аккаунта.', 413, 'TOO_LARGE');
    }
    chunks.push(value);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AccountRequestError('Не удалось прочитать данные аккаунта.', 400, 'INVALID_ACCOUNT_PATCH');
  }
  return validateAccountNamePatch(body);
}

function accountDto(record, userId) {
  if (
    !record ||
    record.id !== userId ||
    typeof record.name !== 'string' ||
    typeof record.email !== 'string'
  )
    throw new AccountRequestError('Не удалось проверить данные аккаунта.', 503, 'ACCOUNT_UNAVAILABLE');
  return { id: record.id, name: record.name, email: record.email };
}

export function createAccountHandlers({ configured, getUser, readUser, updateName, report = () => {} }) {
  const wrap = (action) => async (request) => {
    try {
      if (!configured())
        throw new AccountRequestError('Аккаунты пока не подключены.', 503, 'NOT_CONFIGURED');
      return await action(request);
    } catch (error) {
      if (error instanceof AccountRequestError)
        return reply({ error: error.message, code: error.code }, error.status);
      report(error.code || 'ACCOUNT_UNAVAILABLE');
      return reply(
        { error: 'Не удалось связаться с сервисом аккаунтов. Повторите попытку.', code: 'ACCOUNT_UNAVAILABLE' },
        503,
      );
    }
  };
  const authorize = async (request) => {
    const user = await getUser();
    if (!user?.id)
      throw new AccountRequestError('Войдите в аккаунт заново.', 401, 'UNAUTHORIZED');
    if (request.headers.get('x-mycloset-account') !== user.id)
      throw new AccountRequestError('Аккаунт изменился. Обновите страницу.', 409, 'ACCOUNT_CHANGED');
    return user;
  };
  return {
    GET: wrap(async (request) => {
      const user = await authorize(request);
      return reply({ user: accountDto(await readUser(user.id), user.id) });
    }),
    PATCH: wrap(async (request) => {
      if (!sameAuthOrigin(request))
        throw new AccountRequestError('Измените имя на странице аккаунта MyCloset.', 403, 'INVALID_ORIGIN');
      const user = await authorize(request);
      const { name } = await readPatch(request);
      const result = await updateName(name);
      if (result?.error)
        throw new AccountRequestError(
          result.error.status === 429
            ? 'Слишком много изменений. Попробуйте немного позже.'
            : 'Сервис аккаунтов не сохранил имя. Повторите попытку.',
          result.error.status === 429 ? 429 : 503,
          result.error.status === 429 ? 'TOO_MANY_REQUESTS' : 'ACCOUNT_UPDATE_FAILED',
        );
      const saved = accountDto(await readUser(user.id), user.id);
      if (saved.name !== name)
        throw new AccountRequestError(
          'Не удалось подтвердить новое имя. Обновите данные аккаунта.',
          503,
          'ACCOUNT_UPDATE_UNCONFIRMED',
        );
      return reply({ user: saved });
    }),
  };
}
