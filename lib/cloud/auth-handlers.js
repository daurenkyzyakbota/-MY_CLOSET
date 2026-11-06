const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const SIGNUP_BODY_LIMIT = 8192;

class AuthRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sameAuthOrigin(request) {
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

async function signupJson(request) {
  if (!sameAuthOrigin(request))
    throw new AuthRequestError('Откройте регистрацию на сайте MyCloset.', 403, 'INVALID_ORIGIN');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    throw new AuthRequestError('Нужен запрос JSON.', 415, 'INVALID_CONTENT_TYPE');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > SIGNUP_BODY_LIMIT))
    throw new AuthRequestError('Слишком много данных регистрации.', 413, 'TOO_LARGE');
  const reader = request.clone().body?.getReader();
  if (!reader) throw new AuthRequestError('Нет данных регистрации.', 400, 'INVALID_INPUT');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > SIGNUP_BODY_LIMIT) {
      // Do not await cancellation of a tee branch while the original is unused.
      void reader.cancel().catch(() => {});
      throw new AuthRequestError('Слишком много данных регистрации.', 413, 'TOO_LARGE');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AuthRequestError('Не удалось прочитать данные регистрации.', 400, 'INVALID_INPUT');
  }
}

function privateResponse(response) {
  response.headers.set('Cache-Control', PRIVATE_HEADERS['Cache-Control']);
  const vary = response.headers.get('Vary') || '';
  if (!vary.split(',').some((value) => value.trim().toLowerCase() === 'cookie'))
    response.headers.set('Vary', [vary, 'Cookie'].filter(Boolean).join(', '));
  return response;
}

export function createAuthHandlers({
  configured,
  proxy,
  validateRegistrationInput,
  normalizeEmailAddress,
  validateEmailDomain,
  report = () => {},
}) {
  const handle = (method) => async (request, context) => {
    try {
      const { path = [] } = await context.params;
      const endpoint = path.join('/');
      if (endpoint === 'delete-user' && method === 'POST')
        throw new AuthRequestError(
          'Используйте форму удаления в разделе «Аккаунт».',
          400,
          'INVALID_ACTION',
        );
      if (!configured())
        throw new AuthRequestError(
          'Облачное подключение ещё не настроено.',
          503,
          'NOT_CONFIGURED',
        );
      let forwarded = request;
      if (endpoint === 'sign-up/email' && method === 'POST') {
        const body = validateRegistrationInput(await signupJson(request));
        const { domain } = normalizeEmailAddress(body.email);
        await validateEmailDomain(domain);
        const headers = new Headers(request.headers);
        headers.delete('content-length');
        // Frameworks can wrap Request in a tracking Proxy. A native Worker
        // Request constructor cannot use that Proxy as a branded Request.
        forwarded = new Request(request.url, {
          method: request.method,
          headers,
          body: JSON.stringify(body),
          signal: request.signal,
          redirect: request.redirect,
        });
      }
      const response = await proxy(method, forwarded, context);
      return privateResponse(response);
    } catch (error) {
      const handled = Number.isInteger(error.status) && error.status >= 400 && error.status <= 503;
      if (!handled) report(error.code || 'AUTH_UNAVAILABLE');
      const retryAfter =
        Number.isInteger(error.retryAfter) && error.retryAfter > 0
          ? Math.min(error.retryAfter, 86400)
          : null;
      return Response.json(
        {
          code: handled ? error.code || 'INVALID_REQUEST' : 'AUTH_UNAVAILABLE',
          message: handled
            ? error.message
            : 'Не удалось проверить аккаунт. Проверьте подключение и повторите попытку.',
        },
        {
          status: handled ? error.status : 503,
          headers: { ...PRIVATE_HEADERS, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) },
        },
      );
    }
  };
  return Object.fromEntries(
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => [method, handle(method)]),
  );
}
