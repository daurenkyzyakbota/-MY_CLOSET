import { CATEGORIES, COLORS, SUBCATEGORIES } from '../data/model.js';

const groupNames = { ...CATEGORIES, bottom: 'Низ', dress: 'Платье', accessory: 'Аксессуар' };

function validType(category, subcategory) {
  return Boolean(subcategory && Object.hasOwn(SUBCATEGORIES[category] || {}, subcategory));
}

function photoName(category, subcategory, colors) {
  const label = SUBCATEGORIES[category]?.[subcategory] || groupNames[category];
  const color = colors.length === 1 ? COLORS[colors[0]]?.[0].toLocaleLowerCase('ru') : '';
  return color ? `${label} · ${color}` : label;
}

export function normalizePhotoSuggestions({ categories, types = [], colors, categoryUnavailable }) {
  const groups = [...new Set(categories.map(({ key }) => key))]
    .filter((key) => Object.hasOwn(CATEGORIES, key))
    .slice(0, 3);
  const palette = [...new Set(colors)]
    .filter((key) => Object.hasOwn(COLORS, key))
    .slice(0, 3);
  const specificTypes = types
    .filter(({ category, key, confidence }) =>
      groups.includes(category) && validType(category, key) && Number.isFinite(confidence))
    .map(({ category, key, confidence }) => ({ category, subcategory: key, confidence }))
    .slice(0, 3);
  const ranked = categories.filter(({ key }) => groups.includes(key));
  const top = ranked[0];
  const autoFill = {};

  if (Number.isFinite(top?.confidence) && top.confidence >= 0.78 &&
      top.confidence - (ranked[1]?.confidence || 0) >= 0.22) {
    const type = specificTypes.find(({ category, confidence }) =>
      category === top.key && confidence >= 0.72);
    autoFill.category = top.key;
    if (type) autoFill.subcategory = type.subcategory;
    if (palette.length) autoFill.colors = palette;
    autoFill.name = photoName(top.key, autoFill.subcategory, palette);
  }

  return { categories: groups, colors: palette, types: specificTypes, categoryUnavailable, autoFill };
}

/** Promise results may arrive after the user edited the draft. */
export function photoAutofillPatch(draft, { autoFill = {} }, protectedFields = []) {
  const protectedKeys = new Set(protectedFields);
  const patch = {};
  if (!autoFill.category) return patch;

  const keepCategory = protectedKeys.has('category') ||
    (protectedKeys.has('subcategory') && Boolean(draft.subcategory));
  const category = keepCategory ? draft.category : autoFill.category;
  if (category !== draft.category) {
    patch.category = category;
    if (draft.subcategory) patch.subcategory = '';
  }
  const originalType = patch.subcategory ?? draft.subcategory;
  if (category === autoFill.category && !protectedKeys.has('subcategory') &&
      validType(category, autoFill.subcategory) && originalType !== autoFill.subcategory) {
    patch.subcategory = autoFill.subcategory;
  }

  if (autoFill.colors?.length && !protectedKeys.has('colors') &&
      (draft.colors.length !== autoFill.colors.length ||
        draft.colors.some((color, index) => color !== autoFill.colors[index]))) {
    patch.colors = autoFill.colors;
  }

  const subcategory = patch.subcategory ?? draft.subcategory;
  if (!protectedKeys.has('name') && category === autoFill.category &&
      (!subcategory || !autoFill.subcategory || subcategory === autoFill.subcategory)) {
    const name = photoName(category, subcategory, patch.colors ?? draft.colors);
    if (draft.name !== name) patch.name = name;
  }
  return patch;
}
