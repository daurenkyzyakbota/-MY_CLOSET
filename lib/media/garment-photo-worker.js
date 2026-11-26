import * as ort from 'onnxruntime-web/wasm';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  GARMENT_MODEL_SIZE,
  SUBJECT_MODEL_SIZE,
  clearlyUnrelatedSubject,
  garmentCategoryCandidates,
  garmentTypeCandidates,
} from './garment-photo-model.js';

// Fixed releases of public model weights. No photo is sent to the model host.
const GARMENT_MODEL = {
  url: 'https://huggingface.co/Prikol5ist/pasma/resolve/5346fc6adf7c345fef3ff0ac84abfc11a210b959/models/pasma_small_320_fp32.onnx',
  hash: 'a6d1ccced0b9c5223cc75be531f4a681a6bda48be2211d06777ac7a438f54e40',
  bytes: 21_358_203,
  timeout: 24_000,
};
const SUBJECT_MODEL = {
  url: 'https://huggingface.co/onnxmodelzoo/mobilenetv2-12-int8/resolve/b5c248f66acc836ca8893c58229b00d2520c388b/mobilenetv2-12-int8.onnx',
  hash: 'cc028fe6cae7bc11a4ff53cfc9b79c920e8be65ce33a904ec3e2a8f66d77f95f',
  bytes: 3_655_033,
  timeout: 8_000,
};
const CACHE_NAME = 'mycloset-vision-models-v1';

ort.env.wasm.numThreads = 1;
ort.env.wasm.initTimeout = 12_000;

let session;
let subjectSession;
let modelFailureUntil = 0;
let queue = Promise.resolve();

async function verifiedBytes(response, model) {
  if (!response?.ok || !response.body) throw new Error('Model data is unavailable');
  const declaredBytes = response.headers.get('content-length');
  if (declaredBytes && Number(declaredBytes) !== model.bytes)
    throw new Error('Unexpected model size');
  const bytes = new Uint8Array(model.bytes);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > model.bytes) {
        await reader.cancel();
        throw new Error('Unexpected model size');
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== model.bytes || bytesToHex(sha256(bytes)) !== model.hash)
    throw new Error('Model integrity check failed');
  return bytes;
}

async function loadModel(model) {
  const cache = await globalThis.caches?.open(CACHE_NAME).catch(() => undefined);
  const cached = await cache?.match(model.url).catch(() => undefined);
  if (cached) {
    try {
      return await verifiedBytes(cached, model);
    } catch {
      await cache.delete(model.url).catch(() => {});
    }
  }
  const response = await fetch(model.url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(model.timeout),
  });
  const bytes = await verifiedBytes(response, model);
  if (cache) {
    void cache.put(
      model.url,
      new Response(bytes.slice(), { headers: { 'content-length': String(model.bytes) } }),
    ).catch(() => {});
  }
  return bytes;
}

async function createSession(model) {
  return ort.InferenceSession.create(await loadModel(model), { executionProviders: ['wasm'] });
}

async function hasUnrelatedSubject(pixels) {
  try {
    const model = await subjectSession;
    if (!model) return false;
    const input = new ort.Tensor('float32', new Float32Array(pixels), [
      1, 3, SUBJECT_MODEL_SIZE, SUBJECT_MODEL_SIZE,
    ]);
    const outputs = await model.run({ [model.inputNames[0]]: input });
    return clearlyUnrelatedSubject(outputs[model.outputNames[0]]?.data);
  } catch {
    return false;
  }
}

async function recognize({ id, pixels, subject }) {
  try {
    if (!session) {
      if (Date.now() < modelFailureUntil) throw new Error('Model unavailable');
      self.postMessage({ id, phase: 'loading-model' });
      // Download both models concurrently, then initialize the WASM sessions in sequence.
      const subjectWeights = loadModel(SUBJECT_MODEL).catch(() => null);
      try {
        session = await createSession(GARMENT_MODEL);
      } catch (error) {
        modelFailureUntil = Date.now() + 8_000;
        throw error;
      }
      subjectSession = subjectWeights.then((bytes) =>
        bytes && ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }),
      ).catch(() => null);
    }
    self.postMessage({ id, phase: 'category' });
    const input = new ort.Tensor('float32', new Float32Array(pixels), [
      1, 3, GARMENT_MODEL_SIZE, GARMENT_MODEL_SIZE,
    ]);
    const output = await session.run({ image: input }, ['prob_coarse', 'prob_type']);
    const scores = output.prob_type?.data;
    const categories = garmentCategoryCandidates(output.prob_coarse?.data, scores);
    if (categories.length && await hasUnrelatedSubject(subject)) {
      self.postMessage({ id, unrelated: true });
      return;
    }
    self.postMessage({ id, categories, types: garmentTypeCandidates(scores, categories) });
  } catch {
    self.postMessage({ id, unavailable: true });
  }
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => recognize(data));
};
