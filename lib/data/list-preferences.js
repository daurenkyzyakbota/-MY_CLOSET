import { CATEGORIES, COLORS, SEASONS } from './model.js';
import { SHOPPING_SORTS } from '../styling/shopping-filters.js';

// View preferences belong to this tab, independently of the wardrobe backup.
export const LIST_PREFERENCE_KEYS = Object.freeze({
  wardrobe: 'mycloset:list-preferences:v1:wardrobe',
  favorites: 'mycloset:list-preferences:v1:favorites',
  shopping: 'mycloset:list-preferences:v1:shopping',
});

/** Keep the legacy guest key; account preferences never share that record. */
export function scopedListPreferenceKey(baseKey, ownerId = '') {
  if (typeof ownerId !== 'string' || (ownerId && !/^[a-zA-Z0-9_-]{1,200}$/.test(ownerId)))
    throw new Error('Некорректный аккаунт настроек списка.');
  return ownerId ? `${baseKey}:account:${encodeURIComponent(ownerId)}` : baseKey;
}

export const WARDROBE_PREFERENCES = Object.freeze({
  query: '',
  category: '',
  color: '',
  season: '',
  style: '',
  availability: '',
  sort: 'newest',
});
export const SHOPPING_PREFERENCES = Object.freeze({
  query: '',
  category: '',
  status: 'planned',
  sort: 'newest',
});

const record = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const option = (options, value, fallback = '') =>
  typeof value === 'string' && Object.hasOwn(options, value) ? value : fallback;
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

export function sanitizeWardrobePreferences(value, availableStyles = []) {
  const source = record(value);
  return {
    query: text(source.query, 200),
    category: option(CATEGORIES, source.category),
    color: option(COLORS, source.color),
    season: option(SEASONS, source.season),
    style:
      typeof source.style === 'string' && availableStyles.includes(source.style)
        ? source.style
        : '',
    availability: ['available', 'laundry'].includes(source.availability) ? source.availability : '',
    sort: ['newest', 'oldest', 'name', 'favorites'].includes(source.sort) ? source.sort : 'newest',
  };
}

export function sanitizeShoppingPreferences(value) {
  const source = record(value);
  return {
    query: text(source.query, 120),
    category: option(CATEGORIES, source.category),
    status: ['planned', 'purchased', 'all'].includes(source.status) ? source.status : 'planned',
    sort: option(SHOPPING_SORTS, source.sort, 'newest'),
  };
}

/** Missing parameters leave saved values alone; explicitly empty ones clear them. */
export function wardrobeUrlOverrides(search) {
  const params = new URLSearchParams(search);
  const result = params.get('reset') === '1' ? { ...WARDROBE_PREFERENCES } : {};
  if (params.has('q')) result.query = text(params.get('q'), 200);
  if (params.has('category')) result.category = option(CATEGORIES, params.get('category'));
  if (params.has('availability'))
    result.availability = ['laundry', 'unavailable'].includes(params.get('availability'))
      ? 'laundry'
      : params.get('availability') === 'available'
        ? 'available'
        : '';
  return result;
}

export function readListPreferences(storage, key, sanitize, overrides = {}) {
  let saved = {};
  try {
    const raw = storage?.getItem(key);
    // The entire valid record is under 2 KB. Do not parse arbitrary large storage.
    if (typeof raw === 'string' && raw.length <= 4096) saved = record(JSON.parse(raw));
  } catch {
    // Private browsing, blocked storage and malformed JSON use usable defaults.
  }
  return sanitize({ ...saved, ...record(overrides) });
}

export function writeListPreferences(storage, key, preferences) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

/** Remove superseded deep-link filters without changing any other URL state. */
export function withoutWardrobeUrlFilters(href, fields = ['query', 'category', 'availability']) {
  const url = new URL(href);
  url.searchParams.delete('reset');
  if (fields.includes('query')) url.searchParams.delete('q');
  if (fields.includes('category')) url.searchParams.delete('category');
  if (fields.includes('availability')) url.searchParams.delete('availability');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shoppingUrlOverrides(search) {
  const params = new URLSearchParams(search);
  return params.has('q') ? { query: text(params.get('q'), 120), category: '', status: 'all' } : {};
}

export function withoutShoppingUrlQuery(href) {
  const url = new URL(href);
  url.searchParams.delete('q');
  return `${url.pathname}${url.search}${url.hash}`;
}
