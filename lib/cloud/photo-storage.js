import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { createHash } from 'node:crypto';
import { database } from './cloud-database.js';
import { PHOTO_STORAGE_QUOTA, validateStoredPhoto } from './photo-transport.js';

export function photosConfigured() {
  return ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
    'MYCLOSET_PHOTO_BUCKET'].every((name) => !!process.env[name]);
}

function storageClient() {
  if (!photosConfigured()) throw new Error('Хранилище фотографий не настроено.');
  return new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    forcePathStyle: true,
    requestHandler: new FetchHttpHandler({ requestTimeout: 15000 }),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
}
const objectKey = (userId, id) => `wardrobe/${encodeURIComponent(userId)}/${id}.photo`;
const quotaError = () => Object.assign(new Error('Хранилище фото аккаунта заполнено.'), {
  status: 413, code: 'PHOTO_QUOTA_EXCEEDED',
});

export const photoStorage = {
  async describe(userId, ids) {
    if (!ids.length) return [];
    const { rows } = await database().query(
      'SELECT photo_id AS id,characters FROM public.mycloset_photos WHERE user_id=$1 AND photo_id=ANY($2::text[])',
      [userId, ids],
    );
    return rows;
  },
  async stats(userId) {
    const { rows } = await database().query(
      'SELECT count(*)::int AS count,COALESCE(sum(characters),0)::bigint AS bytes FROM public.mycloset_photos WHERE user_id=$1',
      [userId],
    );
    return { count: Number(rows[0].count), bytes: Number(rows[0].bytes), limit: PHOTO_STORAGE_QUOTA };
  },
  async put(userId, photo, { signal } = {}) {
    let connection;
    let s3;
    let phase = 'validation';
    try {
      validateStoredPhoto(photo);
      phase = 'photo-digest';
      const id = createHash('sha256').update(photo, 'utf8').digest('hex');
      phase = 'database-connection';
      connection = await database().connect();
      phase = 's3-client';
      s3 = storageClient();
      phase = 'transaction';
      await connection.query('BEGIN');
      phase = 'quota-lock';
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`mycloset:photos:${userId}`]);
      phase = 'existing-photo';
      const found = await connection.query(
        'SELECT characters FROM public.mycloset_photos WHERE user_id=$1 AND photo_id=$2', [userId, id],
      );
      if (found.rows.length) {
        await connection.query('COMMIT');
        return { id, bytes: Number(found.rows[0].characters) };
      }
      const usage = await connection.query(
        'SELECT COALESCE(sum(characters),0)::bigint AS bytes FROM public.mycloset_photos WHERE user_id=$1', [userId],
      );
      if (Number(usage.rows[0].bytes) + photo.length > PHOTO_STORAGE_QUOTA) throw quotaError();
      phase = 'object-upload';
      await s3.send(new PutObjectCommand({
        Bucket: process.env.MYCLOSET_PHOTO_BUCKET,
        Key: objectKey(userId, id),
        Body: new TextEncoder().encode(photo),
        ContentType: 'text/plain; charset=utf-8',
        CacheControl: 'private, no-store',
      }), { abortSignal: signal });
      phase = 'photo-metadata';
      await connection.query(
        'INSERT INTO public.mycloset_photos(user_id,photo_id,characters) VALUES($1,$2,$3) ON CONFLICT(user_id,photo_id) DO NOTHING',
        [userId, id, photo.length],
      );
      await connection.query('COMMIT');
      return { id, bytes: photo.length };
    } catch (error) {
      error.photoStage = phase;
      await connection?.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      connection?.release();
      s3?.destroy();
    }
  },
  async get(userId, id, { signal } = {}) {
    const [row] = await this.describe(userId, [id]);
    if (!row) return null;
    const s3 = storageClient();
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: process.env.MYCLOSET_PHOTO_BUCKET, Key: objectKey(userId, id),
      }), { abortSignal: signal });
      if (result.ContentLength !== undefined && Number(result.ContentLength) !== Number(row.characters))
        throw new Error('Неверный размер сохранённой фотографии.');
      const reader = result.Body.transformToWebStream().getReader();
      const chunks = [];
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > Number(row.characters)) {
          await reader.cancel();
          throw new Error('Неверный размер сохранённой фотографии.');
        }
        chunks.push(value);
      }
      const photo = Buffer.concat(chunks).toString('utf8');
      if (photo.length !== Number(row.characters) ||
          createHash('sha256').update(photo, 'utf8').digest('hex') !== id)
        throw new Error('Фотография не прошла проверку целостности.');
      return validateStoredPhoto(photo);
    } finally { s3.destroy(); }
  },
};
