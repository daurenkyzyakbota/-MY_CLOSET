export const GARMENT_MODEL_SIZE = 320;
export const SUBJECT_MODEL_SIZE = 224;

// Pasma Small-320 prob_coarse order documented by the original model.
const CATEGORY_KEYS = ['top', 'bottom', 'outerwear', 'shoes', 'dress', 'accessory'];

// Pasma Small-320 prob_type order. A broad model label such as BOOTS cannot
// distinguish between the wardrobe's more specific ankle boots and tall boots.
const TYPE_KEYS = [
  ['top', 'tshirt'],
  ['top', 'shirt'],
  ['top', 'blouse'],
  ['top', 'sweater'],
  ['top', 'hoodie'],
  ['bottom', 'trousers'],
  ['bottom', 'jeans'],
  ['bottom', 'shorts'],
  ['bottom', 'skirt'],
  ['outerwear', 'jacket'],
  ['outerwear', 'coat'],
  ['outerwear', 'vest'],
  ['dress', 'dress'],
  null, // SHOES
  null, // BOOTS
  ['shoes', 'trainers'],
  ['shoes', 'sandals'],
  null, // ACCESSORY
  ['accessory', 'hat'],
  ['accessory', 'scarf'],
];

const validScore = (score) => Number.isFinite(score) && score >= 0 && score <= 1.001;

export function garmentCategoryCandidates(coarse, types) {
  if (coarse?.length !== CATEGORY_KEYS.length || types?.length !== TYPE_KEYS.length) return [];
  if (![...coarse, ...types].every(validScore)) return [];

  const rated = CATEGORY_KEYS.map((key, index) => ({ key, confidence: coarse[index] }))
    .sort((first, second) => second.confidence - first.confidence);
  if (rated[0].confidence < 0.58 || Math.max(...types) < 0.3) return [];
  const candidates = [rated[0]];
  if (rated[1].confidence >= 0.2 && rated[0].confidence - rated[1].confidence < 0.41)
    candidates.push(rated[1]);
  return candidates;
}

export function garmentTypeCandidates(types, categories) {
  if (!categories.length || types?.length !== TYPE_KEYS.length || !types.every(validScore)) return [];
  const ranked = Array.from(types, (confidence, index) => ({ confidence, index }))
    .sort((first, second) => second.confidence - first.confidence);
  const [best, alternative] = ranked;
  if (best.confidence < 0.3) return [];

  const choices = [best];
  if (alternative.confidence >= 0.24 && best.confidence - alternative.confidence < 0.25) {
    choices.push(alternative);
  }
  const allowed = new Set(categories.map(({ key }) => key));
  return choices.flatMap(({ confidence, index }) => {
    const type = TYPE_KEYS[index];
    if (!type) return [];
    const [category, key] = type;
    return allowed.has(category) ? [{ category, key, confidence }] : [];
  });
}

// ImageNet-1k indices, ONNX Model Zoo synset. Only veto strong animal/scene evidence.
function subjectGroup(index) {
  if (index < 398) return 'animal';
  if (index >= 970 && index <= 980 && index !== 971) return 'landscape';
  return null;
}

export function clearlyUnrelatedSubject(scores) {
  if (scores?.length !== 1_000 || !scores.every(Number.isFinite)) return false;
  let topIndex = 0;
  for (let index = 1; index < scores.length; index++) {
    if (scores[index] > scores[topIndex]) topIndex = index;
  }
  const group = subjectGroup(topIndex);
  if (!group) return false;
  let total = 0;
  let matching = 0;
  for (let index = 0; index < scores.length; index++) {
    const weight = Math.exp(scores[index] - scores[topIndex]);
    total += weight;
    if (subjectGroup(index) === group) matching += weight;
  }
  return matching / total >= 0.86 && 1 / total >= 0.28;
}
