// Development-only pixel-region investigation. Never imported by the app build.
import { recognizePixels } from '../src/engine.js';
import { decodeImage, crop, border, resize, normalizeLighting, binarize } from '../src/image.js';
export async function probe(data, rect, mode = 7) {
  const original = await decodeImage(data);
  const region = crop(original, rect);
  const results = [];
  for (const scale of [1, 2, 4, 6]) for (const stretch of [1, 1.6]) {
    const scaled = resize(region, Math.round(region.width * scale * stretch), Math.round(region.height * scale));
    for (const [variant, image] of [['gray', scaled], ['binary', binarize(scaled)], ['contrast', normalizeLighting(scaled)]]) {
      const read = await recognizePixels(border(image, 16), mode, { alphabet: '0123456789.,-$£€¥₩₱()', layout: false });
      results.push({ scale, stretch, variant, text: read.rawText.trim(), confidence: read.confidence });
    }
  }
  return results;
}
