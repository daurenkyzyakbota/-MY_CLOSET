import { MAX_ITEMS, uid, validateState } from './model.js';
import { itemFromDraft } from './closet-state.js';
import { compressPhoto } from '../media/photos.js';

export const MAX_BATCH_PHOTOS = 20;

export async function prepareBatchPhotos(files, {
  compress = compressPhoto,
  defaults = {},
  onProgress = () => {},
  shouldAbort = () => false,
} = {}) {
  if (!files?.length || files.length > MAX_BATCH_PHOTOS)
    throw new Error(`Выберите от 1 до ${MAX_BATCH_PHOTOS} фотографий.`);
  const list = Array.from(files);
  const rows = [];
  for (let index = 0; index < list.length; index++) {
    if (shouldAbort()) throw new DOMException('Добавление фотографий отменено.', 'AbortError');
    const file = list[index];
    const row = {
      draft: itemFromDraft({
        ...defaults,
        id: uid(),
        name: (String(file.name || '').replace(/\.[^.]+$/, '').trim() || `Вещь ${index + 1}`).slice(0, 100),
        colors: [...(defaults.colors || [])],
        seasons: [...(defaults.seasons || [])],
      }),
      error: '',
    };
    try {
      row.draft.photo = await compress(file);
    } catch (cause) {
      row.error = cause.message || 'Не удалось обработать фотографию.';
    }
    if (shouldAbort()) throw new DOMException('Добавление фотографий отменено.', 'AbortError');
    rows.push(row);
    onProgress({ completed: index + 1, total: list.length, row });
  }
  return rows;
}

export function addItemBatch(state, drafts) {
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > MAX_BATCH_PHOTOS)
    throw new Error(`За один раз можно добавить от 1 до ${MAX_BATCH_PHOTOS} вещей.`);
  if (state.items.length + drafts.length > MAX_ITEMS)
    throw new Error(`В гардеробе может быть до ${MAX_ITEMS} вещей. Уменьшите выбранную партию.`);
  if (drafts.some((draft) => !draft || typeof draft !== 'object' || draft.shoppingId || !draft.photo))
    throw new Error('Уберите карточки с ошибками обработки фотографии перед сохранением.');
  const records = drafts.map((draft) => itemFromDraft(draft));
  if (new Set(records.map((record) => record.id)).size !== records.length ||
    records.some((record) => state.items.some((item) => item.id === record.id)))
    throw new Error('Вещь из этой партии уже добавлена. Откройте добавление фотографий заново.');
  // Validate the entire proposed wardrobe before changing even one record.
  const checked = validateState({ ...state, items: [...state.items, ...records] });
  state.items = checked.items;
  return records.map((record) => record.id);
}
