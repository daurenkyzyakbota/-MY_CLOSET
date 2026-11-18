import { removeConnectedBackground } from './photo-background.js';

function paletteKey(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const saturation = spread / Math.max(1, max);
  if (max < 53) return 'black';
  if (spread < 16 || saturation < 0.12) {
    if (max >= 211) return 'white';
    return max < 75 ? 'black' : 'gray';
  }

  let hue;
  if (max === r) hue = 60 * (((g - b) / spread + 6) % 6);
  else if (max === g) hue = 60 * ((b - r) / spread + 2);
  else hue = 60 * ((r - g) / spread + 4);

  if (hue < 48 && max < 153) return 'brown';
  if (hue >= 14 && hue < 63 && saturation < 0.39)
    return max >= 149 ? 'beige' : 'brown';
  if (hue < 19 || hue >= 345)
    return max > 152 && min > Math.max(94, 0.48 * max) ? 'pink' : 'red';
  if (hue < 42) return max >= 182 && saturation >= 0.63 ? 'yellow' : 'brown';
  if (hue < 72) return max >= 138 ? 'yellow' : 'brown';
  if (hue < 169) return 'green';
  if (hue <= 255) return 'blue';
  if (hue < 305) return 'purple';
  return max >= 141 && min >= 76 ? 'pink' : 'purple';
}

function visiblePixels(data) {
  let count = 0;
  for (let index = 3; index < data.length; index += 4)
    if (data[index] > 128) count++;
  return count;
}

/**
 * Offer wardrobe palette labels from visible pixels, preferring the foreground.
 * A patterned background can still bias the result. The user chooses what to keep.
 */
export function garmentPhotoColors(image) {
  const { width, height, data } = image;
  const totalPixels = width * height;
  const visible = visiblePixels(data);
  if (totalPixels < 16 || visible < totalPixels * 0.04) return [];
  const alreadyTransparent = visible < totalPixels * 0.92;
  const cleaned = alreadyTransparent ? null : removeConnectedBackground(image, { tolerance: 22 });
  if (cleaned?.removed >= totalPixels * 0.96) return [];
  const backgroundRemoved = cleaned?.removed >= totalPixels * 0.08;
  const foreground = backgroundRemoved ? cleaned.data : data;
  const centerWeight = backgroundRemoved || alreadyTransparent ? 0.75 : 2;

  const votes = new Map();
  let weightSum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (foreground[index + 3] <= 128) continue;
      const dx = (x + 0.5) / width - 0.5;
      const dy = (y + 0.5) / height - 0.5;
      const weight = Math.exp(-centerWeight * 4 * (dx * dx + dy * dy));
      const key = paletteKey(foreground[index], foreground[index + 1], foreground[index + 2]);
      votes.set(key, (votes.get(key) || 0) + weight);
      weightSum += weight;
    }
  }

  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] / weightSum < 0.22) return [];
  const threshold = Math.max(weightSum * 0.145, sorted[0][1] * 0.26);
  return sorted.filter(([, score]) => score >= threshold).slice(0, 3).map(([key]) => key);
}
