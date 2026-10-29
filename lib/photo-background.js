const MAX_PIXELS = 1600 * 1600;

function checkPixels(image) {
  if (!Number.isInteger(image?.width) || !Number.isInteger(image?.height) || image.width < 1 || image.height < 1 || image.width * image.height > MAX_PIXELS || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('Не удалось прочитать пиксели фотографии.');
}

function near(data, offset, color, threshold) {
  const r = data[offset] - color[0], g = data[offset + 1] - color[1], b = data[offset + 2] - color[2];
  return r * r + g * g + b * b <= threshold;
}

/** Remove only connected pixels matching one background color; never guesses a subject. */
export function removeConnectedBackground(image, { tolerance = 32, seed = null } = {}) {
  checkPixels(image);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 120) throw new Error('Допуск цвета должен быть от 0 до 120.');
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(data);
  const threshold = 3 * tolerance * tolerance;
  let color;
  let seedIndex;
  if (seed) {
    if (!Number.isFinite(seed.x) || !Number.isFinite(seed.y) || seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) throw new Error('Выберите точку внутри фотографии.');
    seedIndex = Math.floor(seed.y) * width + Math.floor(seed.x);
    const offset = seedIndex * 4;
    if (!data[offset + 3]) return { width, height, data: output, removed: 0 };
    color = [data[offset], data[offset + 1], data[offset + 2]];
  } else {
    const corners = [0, width - 1, (height - 1) * width, width * height - 1]
      .filter(index => data[index * 4 + 3] > 0)
      .map(index => [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]]);
    let best = [];
    for (const candidate of corners) {
      const matches = corners.filter(other => near(other, 0, candidate, threshold));
      if (matches.length > best.length) best = matches;
    }
    // A single arbitrary corner is not enough evidence of a uniform background.
    if (best.length < 2) return { width, height, data: output, removed: 0 };
    color = [0, 1, 2].map(channel => Math.round(best.reduce((sum, value) => sum + value[channel], 0) / best.length));
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0, removed = 0;
  function enqueue(index) {
    if (visited[index]) return;
    visited[index] = 1;
    const offset = index * 4;
    if (!data[offset + 3] || near(data, offset, color, threshold)) queue[tail++] = index;
  }
  if (seedIndex !== undefined) enqueue(seedIndex);
  else {
    for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  }
  while (head < tail) {
    const index = queue[head++];
    if (output[index * 4 + 3]) { output[index * 4 + 3] = 0; removed++; }
    const x = index % width;
    if (x) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < width * (height - 1)) enqueue(index + width);
  }
  return { width, height, data: output, removed };
}

export function alphaMask(image) {
  checkPixels(image);
  const mask = new Uint8ClampedArray(image.width * image.height);
  for (let index = 0; index < mask.length; index++) mask[index] = image.data[index * 4 + 3];
  return mask;
}

export function restoreAlphaMask(image, mask) {
  checkPixels(image);
  if (!(mask instanceof Uint8ClampedArray) || mask.length !== image.width * image.height) throw new Error('Не удалось восстановить предыдущий шаг.');
  for (let index = 0; index < mask.length; index++) image.data[index * 4 + 3] = mask[index];
}

export function paintAlpha(image, original, { x, y, radius = 32, restore = false } = {}) {
  checkPixels(image); checkPixels(original);
  if (image.width !== original.width || image.height !== original.height || ![x, y, radius].every(Number.isFinite) || radius < 1 || radius > 200) throw new Error('Не удалось применить кисть.');
  let changed = 0;
  const left = Math.max(0, Math.floor(x - radius)), right = Math.min(image.width - 1, Math.ceil(x + radius));
  const top = Math.max(0, Math.floor(y - radius)), bottom = Math.min(image.height - 1, Math.ceil(y + radius));
  for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) {
    const distance = Math.hypot(px - x, py - y);
    if (distance >= radius) continue;
    const strength = Math.min(1, (radius - distance) / Math.max(1, radius * .25));
    const offset = (py * image.width + px) * 4 + 3;
    const previous = image.data[offset];
    image.data[offset] = Math.round(restore ? previous + (original.data[offset] - previous) * strength : previous * (1 - strength));
    if (image.data[offset] !== previous) changed++;
  }
  return changed;
}

export function visiblePixelCount(image) {
  checkPixels(image);
  let visible = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) if (image.data[offset]) visible++;
  return visible;
}

export async function loadPhotoCanvas(source) {
  if (typeof source !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(source)) throw new Error('Сначала загрузите фотографию вещи.');
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Не удалось открыть фотографию.'));
    element.src = source;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Изображение повреждено.');
  const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Браузер не поддерживает обработку фотографии.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function encodeEditedPhoto(canvas) {
  let current = canvas;
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = current.toDataURL('image/webp', .95);
    if (/^data:image\/(webp|png);base64,/i.test(result) && result.length <= 4000000) return result;
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(current.width * .8));
    smaller.height = Math.max(1, Math.round(current.height * .8));
    const context = smaller.getContext('2d');
    if (!context) break;
    context.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  throw new Error('Не удалось уменьшить обработанное фото. Попробуйте другую фотографию.');
}
