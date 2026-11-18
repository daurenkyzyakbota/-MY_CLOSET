import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhotoSuggestions,
  photoAutofillPatch,
} from '../lib/media/garment-photo-autofill.js';

const predictions = {
  categories: [{ key: 'top', confidence: 0.94 }],
  types: [{ category: 'top', key: 'shirt', confidence: 0.86 }],
  colors: ['blue'],
};
const start = { name: '', category: 'outerwear', subcategory: '', colors: [], seasons: ['summer'] };

test('clear garment prediction generates an editable type and name without guessing other fields', () => {
  const results = normalizePhotoSuggestions(predictions);
  assert.deepEqual(photoAutofillPatch(start, results), {
    category: 'top',
    subcategory: 'shirt',
    colors: ['blue'],
    name: 'Рубашка · синий',
  });
  assert.equal(start.name, '');
  assert.deepEqual(start.seasons, ['summer']);
});

test('an uncertain or unavailable model leaves the draft alone while preserving manual suggestions', () => {
  const results = normalizePhotoSuggestions({
    ...predictions,
    categories: [{ key: 'top', confidence: 0.71 }],
  });
  assert.deepEqual(results.categories, ['top']);
  assert.deepEqual(results.colors, ['blue']);
  assert.deepEqual(photoAutofillPatch(start, results), {});
});

test('late suggestions preserve user choices and do not insert a mismatched subtype or name', () => {
  const results = normalizePhotoSuggestions(predictions);
  assert.deepEqual(photoAutofillPatch({
    ...start,
    name: 'Моя куртка',
    subcategory: 'jacket',
    colors: ['black'],
  }, results, new Set(['name', 'category', 'subcategory', 'colors'])), {});
  assert.deepEqual(photoAutofillPatch(start, results, ['category']), { colors: ['blue'] });
  assert.deepEqual(photoAutofillPatch({ ...start, colors: ['white'] }, results, ['colors']), {
    category: 'top',
    subcategory: 'shirt',
    name: 'Рубашка · белый',
  });
});
