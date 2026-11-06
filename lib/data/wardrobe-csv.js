import { CATEGORIES, COLORS, SEASONS, SUBCATEGORIES, MAX_ITEMS, localDate } from './model.js';
import { getWearStatistics } from './wardrobe-life.js';

const HEADERS = [
  'ID',
  'Название',
  'Категория',
  'Тип вещи',
  'Цвета',
  'Сезоны',
  'Бренд',
  'Размер',
  'Материал',
  'Стиль',
  'Доступность',
  'Избранное',
  'Количество носок',
  'Последняя носка',
  'Дата покупки',
];

/** Apostrophe forces spreadsheet text, including formulas after leading controls. */
export function csvCell(value) {
  let text = String(value ?? '');
  if (
    /^[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@]/u.test(text) ||
    /^[\t\r\n]/.test(text)
  )
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** Export actual owned records in the current filtered order; photos stay out. */
export function createWardrobeCsv(
  state,
  itemIds = state.items.map((item) => item.id),
  today = localDate(),
) {
  if (
    !Array.isArray(itemIds) ||
    itemIds.length > MAX_ITEMS ||
    new Set(itemIds).size !== itemIds.length
  )
    throw new Error('Не удалось определить вещи для таблицы. Обновите список.');
  const owned = new Map(state.items.map((item) => [item.id, item]));
  const items = itemIds.map((id) => owned.get(id));
  if (items.some((item) => !item))
    throw new Error('Список вещей изменился. Подготовьте таблицу ещё раз.');
  const statistics = new Map(getWearStatistics(state, today).items.map((row) => [row.id, row]));
  const rows = items.map((item) => [
    item.id,
    item.name,
    CATEGORIES[item.category],
    SUBCATEGORIES[item.category]?.[item.subcategory] || '',
    item.colors.map((color) => COLORS[color][0]).join(' / '),
    item.seasons.map((season) => SEASONS[season]).join(' / '),
    item.brand,
    item.size,
    item.material,
    item.style,
    item.available ? 'Готова к выходу' : 'В стирке',
    item.favorite ? 'Да' : 'Нет',
    statistics.get(item.id).wearCount,
    statistics.get(item.id).lastWorn || '',
    item.purchaseDate,
  ]);
  return (
    '\uFEFF' + [HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  );
}
