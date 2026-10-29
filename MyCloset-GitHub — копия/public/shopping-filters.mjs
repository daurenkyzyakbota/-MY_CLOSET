import { CATEGORIES, COLORS, SEASONS } from './model.mjs';
import { STYLE_OPTIONS } from './stylist.mjs';

export const SHOPPING_SORTS = {
  newest: 'Сначала новые',
  oldest: 'Сначала старые',
  name: 'По названию',
  'budget-asc': 'Бюджет: по возрастанию',
  'budget-desc': 'Бюджет: по убыванию'
};

const normalize = value => String(value ?? '').normalize('NFC').toLocaleLowerCase('ru').replaceAll('ё', 'е');
const label = (options, key) => typeof key === 'string' && Object.hasOwn(options, key) ? options[key] : '';
const timestamp = item => Number.isFinite(Date.parse(item.createdAt)) ? Date.parse(item.createdAt) : 0;
const budget = item => typeof item.budget === 'number' && Number.isFinite(item.budget) && item.budget >= 0 ? item.budget : null;

function searchText(item) {
  const colors = Array.isArray(item.colors) ? item.colors.map(color => label(COLORS, color)?.[0] || '') : [];
  return normalize([
    item.name, item.notes, item.size, item.style, label(STYLE_OPTIONS, item.style),
    label(CATEGORIES, item.category), label(SEASONS, item.season), ...colors
  ].filter(value => value !== undefined && value !== null).join(' '));
}

/** Filters and orders a copy of the list; an empty budget is always last in budget ordering. */
export function filterShoppingList(items, { query = '', category = '', status = 'planned', sort = 'newest' } = {}) {
  if (!Array.isArray(items)) return [];
  const selectedStatus = ['planned', 'purchased', 'all'].includes(status) ? status : 'planned';
  const selectedSort = Object.hasOwn(SHOPPING_SORTS, sort) ? sort : 'newest';
  const words = normalize(query).trim().split(/\s+/u).filter(Boolean);
  const result = items.filter(item => item && typeof item === 'object' && !Array.isArray(item)
    && (selectedStatus === 'all' || item.status === selectedStatus)
    && (!category || item.category === category)
    && (!words.length || words.every(word => searchText(item).includes(word))));

  const newest = (a, b) => timestamp(b) - timestamp(a);
  const stable = (a, b) => newest(a, b) || String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en');
  return result.sort((a, b) => {
    if (selectedSort === 'name') return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru', { sensitivity: 'base', numeric: true }) || stable(a, b);
    if (selectedSort === 'oldest') return -newest(a, b) || String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en');
    if (selectedSort === 'budget-asc' || selectedSort === 'budget-desc') {
      const left = budget(a), right = budget(b);
      if (left === null && right !== null) return 1;
      if (left !== null && right === null) return -1;
      if (left !== null && right !== null && left !== right) return selectedSort === 'budget-asc' ? left - right : right - left;
    }
    return stable(a, b);
  });
}
