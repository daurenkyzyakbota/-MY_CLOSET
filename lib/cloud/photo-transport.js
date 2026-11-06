import { validateState } from '../data/model.js';

export const PHOTO_REFERENCE_PREFIX = 'mycloset-photo:';
export const MAX_PHOTO_CHARACTERS = 4000000;
export const MAX_SNAPSHOT_PHOTO_CHARACTERS = 50000000;
export const PHOTO_STORAGE_QUOTA = 200 * 1024 * 1024;
export const isPhotoId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isPhotoReference = (value) =>
  typeof value === 'string' && value.startsWith(PHOTO_REFERENCE_PREFIX) &&
  isPhotoId(value.slice(PHOTO_REFERENCE_PREFIX.length));
export const photoReferenceId = (value) => value.slice(PHOTO_REFERENCE_PREFIX.length);
export class PhotoSnapshotValidationError extends Error {
  constructor(message) { super(message); this.name = 'PhotoSnapshotValidationError'; }
}

export function validateStoredPhoto(photo) {
  if (typeof photo !== 'string' || !photo || photo.length > MAX_PHOTO_CHARACTERS ||
      !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*$/.test(photo))
    throw new Error('Фотография должна быть JPEG, PNG или WebP размером до 4 МБ после обработки.');
  return photo;
}

// Only wardrobe-owned photos are externalized. Backups and IndexedDB always
// keep their original, self-contained data URIs, including photos in the trash.
export function photoSlots(snapshot) {
  const slots = [];
  if (Array.isArray(snapshot?.items)) snapshot.items.forEach((record, index) => {
    if (record && typeof record === 'object') slots.push({ record, key: `items/${index}` });
  });
  if (Array.isArray(snapshot?.trash)) snapshot.trash.forEach((entry, index) => {
    if (entry?.type === 'item' && entry.record && typeof entry.record === 'object')
      slots.push({ record: entry.record, key: `trash/${index}/record` });
  });
  return slots;
}

export async function photoDigest(photo) {
  const bytes = new TextEncoder().encode(photo);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function externalizeSnapshotPhotos(snapshot, { findExisting, upload, assertCurrent = () => {} }) {
  const wire = structuredClone(snapshot);
  const photos = new Map();
  for (const { record } of photoSlots(wire)) {
    if (!record.photo) continue;
    validateStoredPhoto(record.photo);
    assertCurrent();
    const id = await photoDigest(record.photo);
    photos.set(id, record.photo);
    record.photo = PHOTO_REFERENCE_PREFIX + id;
  }
  if (!photos.size) return wire;
  const existing = new Set(await findExisting([...photos.keys()]));
  for (const [id, photo] of photos) {
    assertCurrent();
    if (!existing.has(id)) await upload(id, photo);
  }
  assertCurrent();
  return wire;
}

export async function hydrateSnapshotPhotos(snapshot, { download, assertCurrent = () => {} }) {
  const local = structuredClone(snapshot);
  const ids = [...new Set(photoSlots(local).map(({ record }) => record.photo)
    .filter(isPhotoReference).map(photoReferenceId))];
  const photos = new Map();
  let offset = 0;
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
    while (offset < ids.length) {
      const id = ids[offset++];
      assertCurrent();
      const photo = validateStoredPhoto(await download(id));
      if (await photoDigest(photo) !== id) throw new Error('Не удалось проверить целостность фотографии.');
      photos.set(id, photo);
    }
  }));
  assertCurrent();
  for (const { record } of photoSlots(local))
    if (isPhotoReference(record.photo)) record.photo = photos.get(photoReferenceId(record.photo));
  return local;
}

export async function validatePhotoSnapshot(input, describePhotos = async () => []) {
  const stripped = structuredClone(input);
  const references = new Map();
  for (const { record, key } of photoSlots(stripped)) {
    if (!isPhotoReference(record.photo)) continue;
    references.set(key, record.photo);
    record.photo = '';
  }
  let checked;
  try { checked = validateState(stripped); }
  catch (error) { throw new PhotoSnapshotValidationError(error.message); }
  const ids = [...new Set([...references.values()].map(photoReferenceId))];
  const rows = ids.length ? await describePhotos(ids) : [];
  const sizes = new Map(rows.map((row) => [row.id, Number(row.characters)]));
  for (const id of ids)
    if (!sizes.has(id) || !Number.isSafeInteger(sizes.get(id)) || sizes.get(id) < 1 ||
        sizes.get(id) > MAX_PHOTO_CHARACTERS)
      throw new PhotoSnapshotValidationError('Фотография не найдена в этом аккаунте. Повторите сохранение.');
  let total = 0;
  for (const { record, key } of photoSlots(checked)) {
    const reference = references.get(key);
    if (reference) {
      record.photo = reference;
      total += sizes.get(photoReferenceId(reference));
    } else total += record.photo?.length || 0;
  }
  if (total > MAX_SNAPSHOT_PHOTO_CHARACTERS)
    throw new PhotoSnapshotValidationError('Суммарный объём фотографий в гардеробе и корзине превышает 50 МБ.');
  return { snapshot: checked, hasReferences: ids.length > 0 };
}
