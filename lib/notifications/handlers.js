import { createHash, timingSafeEqual } from 'node:crypto';
import { boundedJson, sameOrigin } from '../social/handlers.js';
import { NotificationError, onlyFields } from './validation.js';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const reply = (data, status = 200) => Response.json(data, { status, headers });
const digest = (value) => createHash('sha256').update(value).digest();

export function createNotificationHandlers({ getUser, service, cronSecret = () => process.env.MYCLOSET_NOTIFICATION_CRON_SECRET || '', report = () => {} }) {
  const wrap = (work) => async (request) => {
    try { return await work(request); }
    catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500)
        return reply({ error: error.message, code: error.code || 'INVALID_INPUT' }, error.status);
      report(error.code || 'NOTIFICATIONS_UNAVAILABLE');
      return reply({ error: 'Сейчас не удалось обновить уведомления. Повторите попытку.', code: 'NOTIFICATIONS_UNAVAILABLE' }, 503);
    }
  };
  async function actor(request, mutation = false) {
    if (mutation && !sameOrigin(request)) throw new NotificationError('Откройте настройки на сайте MyCloset.', 403, 'INVALID_ORIGIN');
    const user = await getUser();
    if (!user?.id) throw new NotificationError('Войдите в аккаунт.', 401, 'UNAUTHORIZED');
    if (request.headers.get('x-mycloset-account') !== user.id)
      throw new NotificationError('Аккаунт изменился. Обновите страницу.', 409, 'ACCOUNT_CHANGED');
    return user;
  }
  return {
    preferences: {
      GET: wrap(async (request) => reply(await service.preferences((await actor(request)).id))),
      PATCH: wrap(async (request) => {
        const user = await actor(request, true);
        return reply(await service.savePreferences(user.id, await boundedJson(request, 8192)));
      }),
    },
    subscriptions: {
      POST: wrap(async (request) => {
        const user = await actor(request, true);
        if (!user.sessionId) throw new NotificationError('Войдите в аккаунт заново.', 401, 'UNAUTHORIZED');
        const input = onlyFields(await boundedJson(request, 8192), ['endpoint', 'keys', 'expirationTime']);
        return reply(await service.subscribe(user.id, input, user.sessionId));
      }),
      DELETE: wrap(async (request) => {
        const user = await actor(request, true);
        const input = onlyFields(await boundedJson(request, 4096), ['endpoint']);
        return reply(await service.unsubscribe(user.id, input));
      }),
    },
    dispatch: {
      POST: wrap(async (request) => {
        const secret = cronSecret();
        const authorization = request.headers.get('authorization') || '';
        if (secret.length < 32 || !timingSafeEqual(digest(authorization), digest('Bearer ' + secret)))
          throw new NotificationError('Нужен служебный доступ.', 401, 'UNAUTHORIZED');
        if (Number(request.headers.get('content-length') || 0) > 1024)
          throw new NotificationError('Запрос слишком большой.', 413, 'TOO_LARGE');
        return reply(await service.dispatch());
      }),
    },
  };
}
