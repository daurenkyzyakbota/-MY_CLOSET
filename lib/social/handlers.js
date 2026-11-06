const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
const PUBLIC_ACTIONS = new Set([
  'profile.get',
  'people.search',
  'posts.list',
  'posts.get',
  'comments.list',
]);
const LIMIT = 12 * 1024 * 1024;
const reply = (body, status = 200, extraHeaders = {}) =>
  Response.json(body, { status, headers: { ...PRIVATE_HEADERS, ...extraHeaders } });

class RequestError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sameOrigin(request) {
  const target = new URL(request.url);
  const host = request.headers.get('host');
  if (host && /^[a-z0-9.\[\]:-]+$/i.test(host)) {
    const address = new URL(`${target.protocol}//${host}`);
    target.hostname = address.hostname;
    target.port = address.port;
  }
  if (request.headers.get('x-forwarded-proto') === 'https') target.protocol = 'https:';
  return request.headers.get('origin') === target.origin;
}

export async function boundedJson(request, limit = LIMIT) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    throw new RequestError(415, 'Нужен запрос JSON.', 'INVALID_CONTENT_TYPE');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new RequestError(413, 'Слишком много данных. Уменьшите фотографии.', 'TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'Нет данных запроса.', 'INVALID_INPUT');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RequestError(413, 'Слишком много данных. Уменьшите фотографии.', 'TOO_LARGE');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Не удалось прочитать запрос.', 'INVALID_INPUT');
  }
}

export function createSocialHandlers({ configured, getUser, service, report = () => {} }) {
  const wrap = (action) => async (request) => {
    try {
      if (!configured())
        throw new RequestError(503, 'Сообщество пока не подключено.', 'NOT_CONFIGURED');
      return await action(request);
    } catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        const retryAfter =
          error.status === 429 && Number.isInteger(error.retryAfter) && error.retryAfter > 0
            ? Math.min(error.retryAfter, 86400)
            : null;
        return reply(
          {
            error: error.message,
            code: error.code || 'INVALID_REQUEST',
            ...(retryAfter ? { retryAfter } : {}),
          },
          error.status,
          retryAfter ? { 'Retry-After': String(retryAfter) } : {},
        );
      }
      report(error.code || 'SOCIAL_UNAVAILABLE');
      return reply(
        {
          error: 'Не удалось связаться с сообществом. Повторите попытку.',
          code: 'SOCIAL_UNAVAILABLE',
        },
        503,
      );
    }
  };
  return {
    POST: wrap(async (request) => {
      if (!sameOrigin(request))
        throw new RequestError(403, 'Откройте действие на странице MyCloset.', 'INVALID_ORIGIN');
      const body = await boundedJson(request);
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== 'object' ||
        Object.keys(body).some((key) => !['action', 'input'].includes(key)) ||
        typeof body.action !== 'string' ||
        body.action.length > 80 ||
        !body.input ||
        typeof body.input !== 'object' ||
        Array.isArray(body.input)
      )
        throw new RequestError(400, 'Некорректный запрос.', 'INVALID_INPUT');
      if (body.action === 'account.delete' || body.action === 'media.get')
        throw new RequestError(
          400,
          'Используйте специальную форму этого действия.',
          'INVALID_ACTION',
        );
      const expected = request.headers.get('x-mycloset-account');
      let user = expected || !PUBLIC_ACTIONS.has(body.action) ? await getUser() : null;
      if (expected && user?.id !== expected)
        throw new RequestError(409, 'Аккаунт изменился. Обновите страницу.', 'ACCOUNT_CHANGED');
      if (!PUBLIC_ACTIONS.has(body.action)) {
        if (!user?.id) throw new RequestError(401, 'Войдите в аккаунт.', 'UNAUTHORIZED');
        if (!expected)
          throw new RequestError(
            409,
            'Подтвердите текущий аккаунт, обновив страницу.',
            'ACCOUNT_CHANGED',
          );
      }
      const data = await service.execute(body.action, body.input, user);
      return reply({ data });
    }),
    GET: wrap(async (request) => {
      const url = new URL(request.url);
      if (
        [...url.searchParams.keys()].some((key) => !['type', 'id', 'item'].includes(key)) ||
        [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
      )
        throw new RequestError(400, 'Неверный адрес изображения.', 'INVALID_INPUT');
      const user = request.headers.has('cookie') ? await getUser() : null;
      const { photo } = await service.execute(
        'media.get',
        Object.fromEntries(url.searchParams),
        user,
      );
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(photo || '');
      if (!match) throw new RequestError(404, 'Изображение недоступно.', 'NOT_FOUND');
      return new Response(Buffer.from(match[2], 'base64'), {
        headers: {
          ...PRIVATE_HEADERS,
          'Content-Type': match[1],
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }),
  };
}
