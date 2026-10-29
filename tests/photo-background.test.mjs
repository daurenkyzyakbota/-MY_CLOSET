import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaMask, paintAlpha, removeConnectedBackground, restoreAlphaMask, visiblePixelCount } from '../lib/photo-background.js';

function image(width = 7, height = 7, color = [255, 255, 255, 255]) {
  const result = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let index = 0; index < width * height; index++) result.data.set(color, index * 4);
  return result;
}
function pixel(target, x, y, color) { target.data.set(color, (y * target.width + x) * 4); }
function alpha(target, x, y) { return target.data[(y * target.width + x) * 4 + 3]; }
function surroundedIsland() {
  const result = image();
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) pixel(result, x, y, [150, 20, 40, 255]);
  pixel(result, 3, 3, [255, 255, 255, 255]);
  return result;
}

test('edge removal preserves a garment and a same-color island enclosed inside it, without mutating source', () => {
  const original = surroundedIsland(), before = new Uint8ClampedArray(original.data);
  const result = removeConnectedBackground(original, { tolerance: 0 });
  assert.equal(result.removed, 40);
  assert.equal(alpha(result, 0, 0), 0); assert.equal(alpha(result, 2, 2), 255); assert.equal(alpha(result, 3, 3), 255);
  assert.deepEqual(original.data, before);
});

test('a selected background point removes only its connected island, keeping outer background untouched', () => {
  const result = removeConnectedBackground(surroundedIsland(), { tolerance: 0, seed: { x: 3, y: 3 } });
  assert.equal(result.removed, 1); assert.equal(alpha(result, 3, 3), 0); assert.equal(alpha(result, 0, 0), 255); assert.equal(alpha(result, 3, 2), 255);
});

test('tolerance includes similar shades without leaking through a more distinct foreground', () => {
  const source = image(5, 5); pixel(source, 1, 0, [250, 250, 250, 255]); pixel(source, 2, 2, [240, 240, 240, 255]);
  const strict = removeConnectedBackground(source, { tolerance: 0 });
  const tolerant = removeConnectedBackground(source, { tolerance: 5 });
  assert.equal(strict.removed, 23); assert.equal(tolerant.removed, 24); assert.equal(alpha(tolerant, 2, 2), 255);
});

test('ambiguous corners do not guess a background and an explicit transparent seed is a safe no-op', () => {
  const source = image(3, 3); pixel(source, 0, 0, [255, 0, 0, 255]); pixel(source, 2, 0, [0, 255, 0, 255]); pixel(source, 0, 2, [0, 0, 255, 255]); pixel(source, 2, 2, [0, 0, 0, 255]);
  assert.equal(removeConnectedBackground(source, { tolerance: 0 }).removed, 0);
  pixel(source, 1, 1, [123, 45, 67, 0]); assert.equal(removeConnectedBackground(source, { seed: { x: 1, y: 1 } }).removed, 0);
});

test('brush erases and restores original transparency, preserving colors and distant pixels', () => {
  const original = image(9, 9, [24, 90, 153, 120]), current = { ...original, data: new Uint8ClampedArray(original.data) };
  assert.ok(paintAlpha(current, original, { x: 4, y: 4, radius: 2 }) > 0);
  assert.equal(alpha(current, 4, 4), 0); assert.equal(alpha(current, 0, 0), 120);
  assert.ok(paintAlpha(current, original, { x: 4, y: 4, radius: 2, restore: true }) > 0);
  assert.equal(alpha(current, 4, 4), 120);
  for (let offset = 0; offset < current.data.length; offset += 4) assert.deepEqual([...current.data.slice(offset, offset + 3)], [24, 90, 153]);
});

test('alpha history restores an exact prior mask independently of subsequent mutations', () => {
  const source = surroundedIsland(), before = alphaMask(source);
  const result = removeConnectedBackground(source); restoreAlphaMask(source, alphaMask(result));
  assert.equal(visiblePixelCount(source), 9);
  restoreAlphaMask(source, before); assert.equal(visiblePixelCount(source), 49); assert.ok(before.every(value => value === 255));
});

test('all-transparent results are detectable, and restoration never fabricates opaque pixels', () => {
  const original = image(4, 4), result = removeConnectedBackground(original);
  assert.equal(result.removed, 16); assert.equal(visiblePixelCount(result), 0);
  const transparentOriginal = image(4, 4, [0, 0, 0, 0]);
  assert.equal(paintAlpha(result, transparentOriginal, { x: 1, y: 1, radius: 2, restore: true }), 0);
  assert.equal(visiblePixelCount(result), 0);
});

test('malformed dimensions, masks, brush values and background seeds are rejected', () => {
  const source = image();
  for (const tolerance of [NaN, -1, 121]) assert.throws(() => removeConnectedBackground(source, { tolerance }));
  assert.throws(() => removeConnectedBackground({ ...source, width: 0 }));
  assert.throws(() => removeConnectedBackground(source, { seed: { x: -1, y: 1 } }));
  assert.throws(() => restoreAlphaMask(source, new Uint8ClampedArray(3)));
  assert.throws(() => paintAlpha(source, source, { x: 0, y: 0, radius: Infinity }));
});
