const MAX_PIXELS = 40_000_000;

export function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 20000 || height > 20000 || width * height > MAX_PIXELS) {
    throw new RangeError('Image must have positive integer dimensions, at most 20000 per side and 40 megapixels.');
  }
}

export async function decodeImage(input, maxDimension = 2400) {
  if (!Number.isInteger(maxDimension) || maxDimension < 400 || maxDimension > 3200) {
    throw new RangeError('maxDimension must be an integer from 400 to 3200.');
  }
  if (typeof input === 'string') {
    if (input.length > 20 * 1024 * 1024 * 4 / 3 + 100) throw new RangeError('Image exceeds 20 MiB.');
    const match = /^data:(image\/(?:png|jpeg|webp|bmp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(input);
    if (!match) throw new TypeError('Use a PNG/JPEG/WebP/BMP base64 data URL, not a URL or file path.');
    input = new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], { type: match[1] });
  }
  let owned = false;
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    if (input.size > 20 * 1024 * 1024) throw new RangeError('Image exceeds 20 MiB.');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(input.type)) {
      throw new TypeError('Supported image types: PNG, JPEG, WebP, BMP. PDFs and SVG are not supported.');
    }
    if (typeof createImageBitmap === 'function') input = await createImageBitmap(input);
    else {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the image file.'));
        reader.readAsDataURL(input);
      });
      input = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not decode the image.'));
        image.src = data;
      });
    }
    owned = true;
  }
  try {
    const width = input?.naturalWidth || input?.width;
    const height = input?.naturalHeight || input?.height;
    validateDimensions(width, height);
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    let rgba;
    if (ArrayBuffer.isView(input.data) && input.data.BYTES_PER_ELEMENT === 1) {
      if (input.data.length !== width * height * 4) throw new RangeError('RGBA data length must equal width * height * 4.');
      rgba = input.data;
    } else {
      const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('This host does not provide a 2D canvas context.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(input, 0, 0, w, h);
      rgba = ctx.getImageData(0, 0, w, h).data;
    }
    const pixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const pos = rgba === input.data ? (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale))) * 4 : (y * w + x) * 4;
      const gray = (rgba[pos] * 77 + rgba[pos + 1] * 150 + rgba[pos + 2] * 29) / 256;
      pixels[y * w + x] = Math.round(255 + (gray - 255) * rgba[pos + 3] / 255);
    }
    return { pixels, width: w, height: h };
  } finally { if (owned && typeof input.close === 'function') input.close(); }
}

export function resize(image, width, height) {
  const pixels = new Uint8Array(width * height), sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const fx = Math.max(0, (x + .5) * sx - .5), fy = Math.max(0, (y + .5) * sy - .5);
    const ix = Math.floor(fx), iy = Math.floor(fy), dx = fx - ix, dy = fy - iy;
    const a = image.pixels[iy * image.width + ix], b = image.pixels[iy * image.width + Math.min(ix + 1, image.width - 1)];
    const c = image.pixels[Math.min(iy + 1, image.height - 1) * image.width + ix], d = image.pixels[Math.min(iy + 1, image.height - 1) * image.width + Math.min(ix + 1, image.width - 1)];
    pixels[y * width + x] = (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
  }
  return { pixels, width, height };
}

export function crop(image, rect) {
  const left = Math.max(0, Math.floor(rect.left)), top = Math.max(0, Math.floor(rect.top));
  const width = Math.min(image.width - left, Math.ceil(rect.right) - left), height = Math.min(image.height - top, Math.ceil(rect.bottom) - top);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) pixels.set(image.pixels.subarray((y + top) * image.width + left, (y + top) * image.width + left + width), y * width);
  return { pixels, width, height };
}

export function border(image, size = 24) {
  const width = image.width + size * 2, height = image.height + size * 2;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < image.height; y++) pixels.set(image.pixels.subarray(y * image.width, (y + 1) * image.width), (y + size) * width + size);
  return { pixels, width, height };
}

// Global Otsu is useful on an isolated text/number region, not a whole photograph.
export function binarize(image) {
  const histogram = new Uint32Array(256);
  for (const value of image.pixels) histogram[value]++;
  const count = image.pixels.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let weight = 0, background = 0, best = -1, threshold = 127;
  for (let i = 0; i < 255; i++) {
    weight += histogram[i]; background += i * histogram[i];
    if (!weight || weight === count) continue;
    const delta = background / weight - (sum - background) / (count - weight);
    const variance = weight * (count - weight) * delta * delta;
    if (variance > best) { best = variance; threshold = i; }
  }
  return { ...image, pixels: Uint8Array.from(image.pixels, value => value <= threshold ? 0 : 255) };
}

// Estimate paper using connected bright regions at thumbnail resolution.
// A generous crop is only a candidate: the original image remains a separate OCR pass.
export function findPaper(image) {
  const scale = Math.min(1, 320 / Math.max(image.width, image.height));
  const small = resize(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const { width: w, height: h, pixels } = small;
  let best = null;
  for (const threshold of [120, 155, 185, 210]) {
    const mask = Uint8Array.from(pixels, value => value >= threshold ? 1 : 0);
    // Printed separator rules must not split one sheet into unrelated paper
    // components. Close only short vertical gaps at thumbnail resolution.
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (mask[y * w + x]) { y++; continue; }
        const start = y;
        while (y < h && !mask[y * w + x]) y++;
        if (start > 0 && y < h && y - start <= 3) for (let fill = start; fill < y; fill++) mask[fill * w + x] = 1;
      }
    }
    const seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
    for (let start = 0; start < pixels.length; start++) {
      if (seen[start] || !mask[start]) continue;
      let head = 0, tail = 1, left = w, top = h, right = 0, bottom = 0;
      queue[0] = start; seen[start] = 1;
      while (head < tail) {
        const pos = queue[head++], x = pos % w, y = Math.floor(pos / w);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const next of [x > 0 ? pos - 1 : -1, x < w - 1 ? pos + 1 : -1, pos - w, pos + w]) {
          if (next < 0 || next >= pixels.length || seen[next] || !mask[next]) continue;
          seen[next] = 1; queue[tail++] = next;
        }
      }
      const area = (right - left + 1) * (bottom - top + 1), fraction = area / pixels.length, fill = tail / area;
      if (fraction < .15 || fraction > .95 || fill < .55 || bottom - top < h * .35 || right - left < w * .15) continue;
      const score = tail * fill;
      if (!best || score > best.score) best = { left, top, right: right + 1, bottom: bottom + 1, score, fraction };
    }
  }
  if (!best || best.fraction > .95) return null;
  const pad = Math.max(6, Math.min(w, h) * .025);
  return { left: Math.max(0, best.left - pad) / scale, top: Math.max(0, best.top - pad) / scale,
    right: Math.min(w, best.right + pad) / scale, bottom: Math.min(h, best.bottom + pad) / scale };
}

// Illumination normalization with an integral-image local background estimate.
// Unlike a global threshold, this retains faint print under shadows and warm light.
export function normalizeLighting(image, binary = false) {
  const { width: w, height: h, pixels: source } = image;
  const stride = w + 1, sums = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) { sum += source[y * w + x]; sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + sum; }
  }
  const radius = Math.max(12, Math.round(Math.min(w, h) / 30)), pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    const mean = (sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
    const value = source[y * w + x];
    pixels[y * w + x] = binary ? (value < mean * .88 ? 0 : 255) : Math.max(0, Math.min(255, 255 - (mean - value) * 2.2));
  }
  return { pixels, width: w, height: h };
}

export function rotate(image, degrees) {
  const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const w = image.width, h = image.height;
  const width = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin)), height = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = (x - width / 2) * cos + (y - height / 2) * sin + w / 2;
    const sy = -(x - width / 2) * sin + (y - height / 2) * cos + h / 2;
    if (sx >= 0 && sy >= 0 && sx < w - 1 && sy < h - 1) {
      const ix = Math.floor(sx), iy = Math.floor(sy), dx = sx - ix, dy = sy - iy;
      pixels[y * width + x] = (image.pixels[iy * w + ix] * (1 - dx) + image.pixels[iy * w + ix + 1] * dx) * (1 - dy) + (image.pixels[(iy + 1) * w + ix] * (1 - dx) + image.pixels[(iy + 1) * w + ix + 1] * dx) * dy;
    }
  }
  return { pixels, width, height };
}

// Projection-profile deskew. Only small print-like dark components contribute;
// large dark backgrounds and paper borders must not determine the angle.
export function estimateSkew(image) {
  const factor = Math.min(1, 800 / Math.max(image.width, image.height));
  const thumb = normalizeLighting(resize(image, Math.round(image.width * factor), Math.round(image.height * factor)), true);
  const { width: w, height: h, pixels } = thumb, seen = new Uint8Array(pixels.length), queue = new Int32Array(pixels.length), points = [];
  for (let start = 0; start < pixels.length; start++) {
    if (seen[start] || pixels[start] !== 0) continue;
    let head = 0, tail = 1, left = w, right = 0, top = h, bottom = 0;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const pos = queue[head++], x = pos % w, y = Math.floor(pos / w);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [x > 0 ? pos - 1 : -1, x < w - 1 ? pos + 1 : -1, pos - w, pos + w]) {
        if (next < 0 || next >= pixels.length || seen[next] || pixels[next] !== 0) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    if (tail < 3 || tail > 250 || bottom - top < 2 || bottom - top > 28 || right - left > 40) continue;
    for (let i = 0; i < tail; i += 2) points.push([queue[i] % w, Math.floor(queue[i] / w)]);
  }
  if (points.length < 100) return 0;
  function score(angle) {
    const slope = Math.tan(angle * Math.PI / 180), rows = new Uint32Array(h + w + 4);
    for (const [x, y] of points) rows[Math.round(y - slope * (x - w / 2) + w / 2)]++;
    let sum = 0; for (let i = 1; i < rows.length; i++) sum += (rows[i] - rows[i - 1]) ** 2;
    return sum;
  }
  let angle = 0, best = score(0);
  for (let a = -12; a <= 12; a += .5) { const s = score(a); if (s > best) { best = s; angle = a; } }
  const center = angle;
  for (let a = center - .4; a <= center + .4; a += .1) { const s = score(a); if (s > best) { best = s; angle = a; } }
  return Math.abs(angle) < .3 ? 0 : -angle;
}
