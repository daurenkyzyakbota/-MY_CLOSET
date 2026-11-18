import test from 'node:test';
import assert from 'node:assert/strict';
import { garmentPhotoColors } from '../lib/media/garment-photo-colors.js';
import {
  clearlyUnrelatedSubject,
  garmentCategoryCandidates,
  garmentTypeCandidates,
} from '../lib/media/garment-photo-model.js';
import { SUBCATEGORIES } from '../lib/data/model.js';
import { analyzeGarmentPhoto } from '../lib/media/garment-photo-analysis.js';

function picture(example) {
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(example(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

test('palette ignores a connected background and preserves visible fabric colors', () => {
  const image = picture((x, y) => {
    if (x < 7 || x >= 25 || y < 4 || y >= 28) return [244, 244, 244, 255];
    return x < 19 ? [40, 115, 196, 255] : [177, 41, 50, 255];
  });
  assert.deepEqual(garmentPhotoColors(image), ['blue', 'red']);
});

test('palette uses the remaining pixels in a transparent photo and abstains on a blank frame', () => {
  const transparent = picture((x, y) => {
    if (x > 7 && x < 25 && y > 4 && y < 28) return [244, 240, 237, 255];
    return [20, 190, 100, 0];
  });
  assert.deepEqual(garmentPhotoColors(transparent), ['white']);
  assert.deepEqual(garmentPhotoColors(picture(() => [0, 0, 0, 0])), []);
  assert.deepEqual(garmentPhotoColors(picture(() => [228, 226, 225, 255])), []);
});

test('classification maps footwear and dress outputs correctly and abstains when evidence is mixed', () => {
  const types = new Float32Array(20);
  types[13] = 0.86;
  types[12] = 0.22;
  const shoe = garmentCategoryCandidates([0.02, 0.01, 0.0, 0.75, 0.19, 0.03], types);
  assert.deepEqual(shoe.map(({ key }) => key), ['shoes']);
  assert.deepEqual(
    garmentCategoryCandidates([0.0, 0.02, 0.0, 0.29, 0.63, 0.06], types).map(({ key }) => key),
    ['dress', 'shoes'],
  );
  assert.deepEqual(garmentCategoryCandidates([0.26, 0.13, 0.31, 0.12, 0.16, 0.02], types), []);
});

test('specific types map to wardrobe subcategories without narrowing generic classes', () => {
  for (const [index, category, key] of [
    [1, 'top', 'shirt'],
    [2, 'top', 'blouse'],
    [6, 'bottom', 'jeans'],
    [9, 'outerwear', 'jacket'],
    [12, 'dress', 'dress'],
    [15, 'shoes', 'trainers'],
    [19, 'accessory', 'scarf'],
  ]) {
    const scores = Array(20).fill(0);
    scores[index] = 0.95;
    assert.ok(Object.hasOwn(SUBCATEGORIES[category], key));
    assert.deepEqual(garmentTypeCandidates(scores, [{ key: category }]), [
      { category, key, confidence: 0.95 },
    ]);
    assert.deepEqual(garmentTypeCandidates(scores, [{ key: 'unrelated' }]), []);
  }
  const genericBoots = Array(20).fill(0);
  genericBoots[14] = 0.98;
  genericBoots[15] = 0.01;
  assert.deepEqual(garmentTypeCandidates(genericBoots, [{ key: 'shoes' }]), []);
});

test('competing types retain the real scores for review instead of appearing certain', () => {
  const scores = Array(20).fill(0);
  scores[1] = 0.52;
  scores[2] = 0.4;
  const types = garmentTypeCandidates(scores, [{ key: 'top' }]);
  assert.deepEqual(types, [
    { category: 'top', key: 'shirt', confidence: 0.52 },
    { category: 'top', key: 'blouse', confidence: 0.4 },
  ]);
  assert.deepEqual(garmentTypeCandidates(scores, []), []);
  scores[2] = Number.NaN;
  assert.deepEqual(garmentTypeCandidates(scores, [{ key: 'top' }]), []);
});

test('analysis refuses a remote photo URL and respects cancellation before decoding', async () => {
  await assert.rejects(analyzeGarmentPhoto('https://example.com/private.jpg'), /Не удалось открыть/);
  await assert.rejects(
    analyzeGarmentPhoto('data:image/png;base64,', { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
  );
});

test('subject check only vetoes unambiguous animal or scenery signals', () => {
  const animal = new Float32Array(1_000);
  animal[281] = 10;
  const sweater = new Float32Array(1_000);
  sweater[841] = 10;
  const scenery = new Float32Array(1_000);
  scenery[979] = 10;
  assert.equal(clearlyUnrelatedSubject(animal), true);
  assert.equal(clearlyUnrelatedSubject(scenery), true);
  assert.equal(clearlyUnrelatedSubject(sweater), false);
  assert.equal(clearlyUnrelatedSubject(new Float32Array(1_000)), false);
  assert.equal(clearlyUnrelatedSubject(null), false);
});
