import { sameAuthOrigin } from './auth-handlers.js';

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const reply = (body, status = 200) => Response.json(body, { status, headers: HEADERS });
class SessionRequestError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
const fail = (message, status = 503, code = 'SESSIONS_UNAVAILABLE') => { throw new SessionRequestError(message, status, code); };
const date = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit).replace(/[\u0000-\u001f\u007f]/g, '') : '';

export async function readSessionAction(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    fail('Нужен запрос JSON.', 415, 'INVALID_CONTENT_TYPE');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 1024)) fail('Слишком много данных.', 413, 'TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) fail('Выберите действие со входом.', 400, 'INVALID_SESSION_ACTION');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) { await reader.cancel(); fail('Слишком много данных.', 413, 'TOO_LARGE'); }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('Не удалось прочитать действие.', 400, 'INVALID_SESSION_ACTION'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Выберите действие со входом.', 400, 'INVALID_SESSION_ACTION');
  if (body.action === 'revoke-others' && Object.keys(body).length === 1) return body;
  if (body.action === 'revoke' && Object.keys(body).length === 2 && typeof body.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(body.sessionId)) return body;
  fail('Выберите действие со входом.', 400, 'INVALID_SESSION_ACTION');
}

/** Managed SDK tokens remain exclusively on the server; IDs are scoped by listSessions. */
export function createAccountSessionHandlers({ configured, getUser, getSession, listSessions, revokeSession, report = () => {} }) {
  const wrap = (action) => async (request) => {
    try {
      if (!configured()) fail('Аккаунты пока не подключены.', 503, 'NOT_CONFIGURED');
      return await action(request);
    } catch (error) {
      if (error instanceof SessionRequestError) return reply({ error: error.message, code: error.code }, error.status);
      report(error.code || 'SESSIONS_UNAVAILABLE');
      return reply({ error: 'Не удалось проверить активные входы. Повторите попытку.', code: 'SESSIONS_UNAVAILABLE' }, 503);
    }
  };
  const authorizedSessions = async (request) => {
    const user = await getUser();
    if (!user?.id) fail('Войдите в аккаунт заново.', 401, 'UNAUTHORIZED');
    if (request.headers.get('x-mycloset-account') !== user.id) fail('Аккаунт изменился. Обновите страницу.', 409, 'ACCOUNT_CHANGED');
    const sessionResult = await getSession();
    const current = sessionResult?.data;
    if (sessionResult?.error || current?.user?.id !== user.id || !current?.session?.id)
      fail('Не удалось подтвердить текущий вход. Войдите заново.', 401, 'UNAUTHORIZED');
    const result = await listSessions();
    if (result?.error || !Array.isArray(result?.data)) fail('Сервис не вернул список входов. Повторите попытку.');
    const sessions = result.data;
    // Never accept a surprising cross-user response, even from the identity API.
    if (sessions.some((session) => !session || session.userId !== user.id || typeof session.id !== 'string' || typeof session.token !== 'string' || !date(session.expiresAt)))
      fail('Не удалось проверить владельца активных входов.');
    if (!sessions.some((session) => session.id === current.session.id)) fail('Текущий вход больше не активен. Войдите заново.', 401, 'UNAUTHORIZED');
    return { sessions, currentId: current.session.id };
  };
  return {
    GET: wrap(async (request) => {
      const { sessions, currentId } = await authorizedSessions(request);
      const now = Date.now();
      return reply({ sessions: sessions.filter((session) => Date.parse(session.expiresAt) > now).map((session) => ({
        id: session.id, current: session.id === currentId,
        createdAt: date(session.createdAt), updatedAt: date(session.updatedAt), expiresAt: date(session.expiresAt),
        userAgent: text(session.userAgent, 500), ipAddress: text(session.ipAddress, 80),
      })) });
    }),
    POST: wrap(async (request) => {
      if (!sameAuthOrigin(request)) fail('Управляйте входами на странице аккаунта MyCloset.', 403, 'INVALID_ORIGIN');
      const action = await readSessionAction(request);
      const { sessions, currentId } = await authorizedSessions(request);
      const targets = action.action === 'revoke-others'
        ? sessions.filter((session) => session.id !== currentId)
        : sessions.filter((session) => session.id === action.sessionId);
      if (action.action === 'revoke' && !targets.length) fail('Этот вход уже закрыт или не принадлежит аккаунту. Обновите список.', 404, 'SESSION_NOT_FOUND');
      if (targets.some((session) => session.id === currentId)) fail('Для этого устройства используйте кнопку «Выйти из аккаунта».', 400, 'CURRENT_SESSION');
      let revoked = 0;
      for (const target of targets) {
        // The SDK's 0.6 revokeOtherSessions helper targets revoke-all-sessions.
        // Individual official revokeSession calls keep this session untouched.
        const result = await revokeSession(target.token);
        if (result?.error || result?.data?.status !== true)
          return reply({ error: `Не все входы удалось закрыть. Закрыто: ${revoked}. Обновите список и повторите попытку.`, code: 'SESSION_REVOKE_PARTIAL', revoked }, 503);
        revoked++;
      }
      return reply({ revoked });
    }),
  };
}
