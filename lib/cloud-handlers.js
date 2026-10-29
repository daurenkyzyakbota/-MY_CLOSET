import { createHash } from 'node:crypto';
import { MAX_BACKUP_FILE_BYTES, validateState } from './model.js';
import { canonicalSnapshotJson } from './cloud-sync-client.js';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const reply = (body, status = 200) => Response.json(body, { status, headers });
class RequestError extends Error { constructor(status, message, code = '') { super(message); this.status = status; this.code = code; } }
const hash = snapshot => createHash('sha256').update(canonicalSnapshotJson(snapshot), 'utf8').digest('hex');
function requestOrigin(request) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host && /^[a-z0-9.\[\]:-]+$/i.test(host)) { const address = new URL(`${url.protocol}//${host}`); url.hostname = address.hostname; url.port = address.port; }
  if (request.headers.get('x-forwarded-proto') === 'https') url.protocol = 'https:';
  return url.origin;
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new RequestError(415, 'Отправьте JSON-файл гардероба.');
  const limit = MAX_BACKUP_FILE_BYTES + 4096;
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new RequestError(413, 'Гардероб превышает допустимый размер синхронизации. Скачайте резервную копию.');
  const reader = request.body?.getReader(); if (!reader) throw new RequestError(400, 'Отсутствуют данные гардероба.');
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > limit) { await reader.cancel(); throw new RequestError(413, 'Гардероб превышает допустимый размер синхронизации.'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'Не удалось прочитать данные гардероба.'); }
}

export function createCloudHandlers({ getUser, storage, configured = () => true, report = () => {} }) {
  async function authorize(request) {
    if (!configured()) throw new RequestError(503, 'Облачное подключение ещё не настроено.', 'NOT_CONFIGURED');
    const user = await getUser(request);
    if (!user?.id || typeof user.id !== 'string') throw new RequestError(401, 'Войдите в аккаунт, чтобы открыть облачный гардероб.', 'UNAUTHORIZED');
    const expected = request.headers.get('x-mycloset-account');
    if (!expected || expected !== user.id) throw new RequestError(409, 'Аккаунт изменился в другой вкладке. Войдите заново и выберите гардероб.', 'ACCOUNT_CHANGED');
    return user;
  }
  function wrap(action) {
    return async request => {
      try { return await action(request); }
      catch (error) {
        if (error instanceof RequestError) return reply({ error: error.message, code: error.code }, error.status);
        report(error.code || 'CLOUD_ERROR');
        return reply({ error: 'Сейчас не удалось связаться с облаком. Локальный гардероб сохранён.', code: 'CLOUD_UNAVAILABLE' }, 502);
      }
    };
  }
  return {
    GET: wrap(async request => {
      const user = await authorize(request);
      const values = new URL(request.url).searchParams.getAll('revision');
      if (values.length > 1 || values.length && (!/^\d+$/.test(values[0]) || !Number.isSafeInteger(Number(values[0])))) throw new RequestError(400, 'Некорректная версия гардероба.');
      const remote = await storage.read(user.id, values.length ? Number(values[0]) : undefined);
      if (remote.notModified || remote.snapshot === null) return reply(remote);
      const snapshot = validateState(remote.snapshot);
      return reply({ ...remote, snapshot, hash: hash(snapshot) });
    }),
    POST: wrap(async request => {
      const user = await authorize(request);
      if (request.headers.get('origin') !== requestOrigin(request)) throw new RequestError(403, 'Запрос должен идти с этой страницы MyCloset.', 'INVALID_ORIGIN');
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['revision', 'snapshot'].includes(key)) || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new RequestError(400, 'Некорректный запрос синхронизации.');
      let snapshot;
      try { snapshot = validateState(body.snapshot); }
      catch (error) { throw new RequestError(422, `Гардероб не прошёл проверку: ${error.message}`, 'INVALID_SNAPSHOT'); }
      const result = await storage.write(user.id, body.revision, snapshot, hash(snapshot));
      if (!result) throw new RequestError(409, 'В облаке уже есть более новая версия. Выберите, какой гардероб сохранить.', 'REVISION_CONFLICT');
      return reply(result);
    })
  };
}
