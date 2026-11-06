import { CATEGORIES } from '../data/model.js';

const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

/** Conservative category/color matches; availability is explained, not assumed. */
export function findOwnedAlternatives(entry, items, limit = 3) {
  if (!entry || !Object.hasOwn(CATEGORIES, entry.category) || !Array.isArray(items)) return [];
  const maximum = Number.isInteger(limit) && limit >= 1 && limit <= 10 ? limit : 3;
  const desiredColors = Array.isArray(entry.colors) ? entry.colors : [];
  return items
    .filter((item) => item.id !== entry.itemId && item.category === entry.category)
    .map((item) => ({
      item,
      colors: desiredColors.filter((color) => item.colors.includes(color)),
      exactName: normalize(item.name) === normalize(entry.name),
    }))
    .filter((match) => !desiredColors.length || match.colors.length > 0)
    .sort(
      (a, b) =>
        Number(b.exactName) - Number(a.exactName) ||
        b.colors.length - a.colors.length ||
        Number(b.item.available) - Number(a.item.available) ||
        a.item.name.localeCompare(b.item.name, 'ru') ||
        a.item.id.localeCompare(b.item.id, 'en'),
    )
    .slice(0, maximum)
    .map(({ item, colors }) => ({
      item,
      colors,
      reason: desiredColors.length ? 'Совпадают категория и цвет' : 'Та же категория',
    }));
}

export function ownedAlternativeHref(item) {
  return '/wardrobe?' + new URLSearchParams({ reset: '1', q: item.name, category: item.category });
}
