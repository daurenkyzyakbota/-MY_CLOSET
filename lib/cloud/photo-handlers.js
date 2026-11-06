import { isPhotoId, MAX_PHOTO_CHARACTERS, validateStoredPhoto } from './photo-transport.js';
import { sameAuthOrigin } from './auth-handlers.js';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const reply = (value, status = 200) => Response.json(value, { status, headers });
class PhotoRequestError extends Error {
  constructor(status, message, code = '') { super(message); this.status = status; this.code = code; }
}
async function readPhotoJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    throw new PhotoRequestError(415, 'Отправьте фотографию в формате JSON.');
  const limit = MAX_PHOTO_CHARACTERS + 4096;
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new PhotoRequestError(413, 'Слишком большая фотография. Уменьшите её перед сохранением.');
  const reader = request.body?.getReader();
  if (!reader) throw new PhotoRequestError(400, 'Отсутствуют данные фотографии.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new PhotoRequestError(413, 'Слишком большая фотография.');
    }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PhotoRequestError(400, 'Не удалось прочитать данные фотографии.'); }
}

export function createPhotoHandlers({ getUser, storage, configured = () => true, report = () => {} }) {
  async function authorize(request) {
    const user = await getUser(request);
    if (!user?.id) throw new PhotoRequestError(401, 'Войдите в аккаунт заново.', 'UNAUTHORIZED');
    if (request.headers.get('x-mycloset-account') !== user.id)
      throw new PhotoRequestError(409, 'Аккаунт изменился. Повторите действие.', 'ACCOUNT_CHANGED');
    if (!configured()) throw new PhotoRequestError(503, 'Хранилище фотографий временно недоступно.');
    return user;
  }
  const wrap = (action) => async (request) => {
    try { return await action(request); }
    catch (error) {
      if (error instanceof PhotoRequestError)
        return reply({ error: error.message, code: error.code }, error.status);
      if (error.code === 'PHOTO_QUOTA_EXCEEDED')
        return reply({ error: 'Хранилище фото аккаунта заполнено. Локальная копия сохранена.', code: error.code }, 413);
      report(`${error.photoStage || 'request'}:${error.code || error.name || 'PHOTO_STORAGE_ERROR'}`);
      return reply({ error: 'Не удалось сохранить или открыть фотографию. Локальный гардероб сохранён.' }, 502);
    }
  };
  return {
    GET: wrap(async (request) => {
      const user = await authorize(request);
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key) => !['id', 'stats'].includes(key)) ||
          [...params.keys()].some((key) => params.getAll(key).length !== 1))
        throw new PhotoRequestError(400, 'Неверный адрес фотографии.');
      if (params.get('stats') === '1' && !params.has('id')) return reply(await storage.stats(user.id));
      const id = params.get('id');
      if (!isPhotoId(id) || params.has('stats')) throw new PhotoRequestError(400, 'Неверный адрес фотографии.');
      const photo = await storage.get(user.id, id, { signal: request.signal });
      if (!photo) throw new PhotoRequestError(404, 'Фотография не найдена в этом аккаунте.');
      return reply({ photo });
    }),
    POST: wrap(async (request) => {
      const user = await authorize(request);
      if (!sameAuthOrigin(request)) throw new PhotoRequestError(403, 'Откройте MyCloset на этом сайте.');
      const input = await readPhotoJson(request);
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new PhotoRequestError(400, 'Неверный запрос фотографии.');
      if (input.operation === 'check') {
        if (Object.keys(input).some((key) => !['operation', 'ids'].includes(key)) ||
            !Array.isArray(input.ids) || input.ids.length > 100 || !input.ids.every(isPhotoId))
          throw new PhotoRequestError(400, 'Выберите не более 100 фотографий для проверки.');
        const rows = await storage.describe(user.id, [...new Set(input.ids)]);
        return reply({ present: rows.map((row) => row.id) });
      }
      if (Object.keys(input).some((key) => key !== 'photo'))
        throw new PhotoRequestError(400, 'Неверный запрос фотографии.');
      try { validateStoredPhoto(input.photo); }
      catch (error) { throw new PhotoRequestError(422, error.message); }
      return reply(await storage.put(user.id, input.photo, { signal: request.signal }));
    }),
  };
}
