import { garmentPhotoColors } from './garment-photo-colors.js';
import { GARMENT_MODEL_SIZE, SUBJECT_MODEL_SIZE } from './garment-photo-model.js';

const COLOR_SIZE = 88;
const MAX_PHOTO_DATA_LENGTH = 4_000_000;
const PHOTO_DATA = /^data:image\/(?:jpeg|png|webp);base64,/i;
const MODEL_TIMEOUT = 40_000;
const IDLE_TIMEOUT = 90_000;
const running = new Map();
let nextId = 0;
let worker = null;
let idleTimer;

function finish(id, result, aborted = false) {
  const work = running.get(id);
  if (!work) return;
  running.delete(id);
  clearTimeout(work.timer);
  work.signal?.removeEventListener('abort', work.abort);
  if (aborted) work.reject(work.signal.reason);
  else work.resolve(result);
  if (!running.size && worker) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopWorker, IDLE_TIMEOUT);
  }
}

function stopWorker() {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = null;
  for (const id of running.keys()) finish(id, { unavailable: true });
}

function getWorker() {
  if (worker) return worker;
  const client = new Worker(new URL('./garment-photo-worker.js', import.meta.url), { type: 'module' });
  client.onmessage = ({ data }) => {
    if (client !== worker) return;
    if (data.phase) {
      running.get(data.id)?.onProgress?.(data.phase);
      return;
    }
    finish(data.id, data);
  };
  client.onerror = (event) => {
    event.preventDefault();
    if (client === worker) stopWorker();
  };
  worker = client;
  return client;
}

function classify(pixels, subject, { signal, onProgress }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const id = ++nextId;
    let client;
    try {
      client = getWorker();
    } catch {
      resolve({ unavailable: true });
      return;
    }
    clearTimeout(idleTimer);
    const abort = () => finish(id, null, true);
    const timer = setTimeout(stopWorker, MODEL_TIMEOUT);
    running.set(id, { resolve, reject, timer, signal, abort, onProgress });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      client.postMessage(
        { id, pixels: pixels.buffer, subject: subject.buffer },
        [pixels.buffer, subject.buffer],
      );
    } catch {
      stopWorker();
    }
  });
}

async function openPhoto(photo, signal) {
  if (
    typeof photo !== 'string' ||
    photo.length > MAX_PHOTO_DATA_LENGTH ||
    !PHOTO_DATA.test(photo)
  ) throw new Error('Не удалось открыть фотографию для подсказок.');
  const image = new Image();
  image.src = photo;
  try {
    await image.decode();
  } catch {
    throw new Error('Не удалось открыть фотографию для подсказок.');
  }
  signal?.throwIfAborted();
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error('Не удалось открыть фотографию для подсказок.');
  return image;
}

function scaledPixels(image, size, fit = 'inside') {
  const dimension = fit === 'cover' ? Math.min : Math.max;
  const scale = size / dimension(image.naturalWidth, image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = fit === 'inside' ? width : size;
  canvas.height = fit === 'inside' ? height : size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Браузер не может прочитать фотографию для подсказок.');
  if (fit !== 'inside') {
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
  }
  context.drawImage(
    image,
    Math.floor((canvas.width - width) / 2),
    Math.floor((canvas.height - height) / 2),
    width,
    height,
  );
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function hasVisualDetail(image) {
  const { data } = image;
  let min = 255;
  let max = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    minAlpha = Math.min(alpha, minAlpha);
    maxAlpha = Math.max(alpha, maxAlpha);
    if (alpha < 128) continue;
    const light = data[index] * 0.25 + data[index + 1] * 0.5 + data[index + 2] * 0.25;
    min = Math.min(light, min);
    max = Math.max(light, max);
  }
  return max - min >= 24 || (maxAlpha > 200 && minAlpha < 24);
}

function modelTensor({ data }, mean = [0, 0, 0], deviation = [1, 1, 1]) {
  const pixelCount = data.length / 4;
  const tensor = new Float32Array(pixelCount * 3);
  for (let channel = 0; channel < 3; channel++) {
    for (let index = 0; index < pixelCount; index++) {
      tensor[pixelCount * channel + index] =
        (data[index * 4 + channel] / 255 - mean[channel]) / deviation[channel];
    }
  }
  return tensor;
}

/** Analyze the stored image locally. The worker requests only public model weights. */
export async function analyzeGarmentPhoto(photo, { signal, onProgress } = {}) {
  signal?.throwIfAborted();
  onProgress?.('colors');
  const image = await openPhoto(photo, signal);
  const pixels = scaledPixels(image, COLOR_SIZE);
  const colors = garmentPhotoColors(pixels);
  if (!hasVisualDetail(pixels))
    return { colors, categories: [], types: [], categoryUnavailable: false };

  onProgress?.('loading-model');
  const garment = modelTensor(scaledPixels(image, GARMENT_MODEL_SIZE, 'contain'));
  const subject = modelTensor(
    scaledPixels(image, SUBJECT_MODEL_SIZE, 'cover'),
    [0.485, 0.456, 0.406],
    [0.229, 0.224, 0.225],
  );
  const result = await classify(garment, subject, { signal, onProgress });
  signal?.throwIfAborted();
  return {
    colors: result.unrelated ? [] : colors,
    categories: result.categories || [],
    types: result.types || [],
    categoryUnavailable: result.unavailable === true,
  };
}
