import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeImage, resize, border, normalizeLighting, findPaper, validateDimensions } from '../src/image.js';

test('RGBA input is fully local and composites transparent pixels onto white', async () => {
  const image = await decodeImage({ width: 2, height: 1, data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]) });
  assert.deepEqual([...image.pixels], [255, 0]);
  assert.equal(border(image).width, 50);
});
test('uniform paper remains white after illumination normalization', () => {
  const image = { width: 100, height: 100, pixels: new Uint8Array(10000).fill(140) };
  assert.ok(normalizeLighting(image).pixels.every(x => x === 255));
  assert.equal(findPaper(image), null);
});
test('bilinear resampling and borders preserve image geometry', () => {
  const image = { width: 2, height: 2, pixels: new Uint8Array([0, 255, 255, 0]) };
  const output = resize(image, 4, 4);
  assert.equal(output.pixels.length, 16);
  assert.equal(output.pixels[0], 0);
  assert.equal(border(image, 2).pixels[2 * 6 + 2], 0);
});
test('a full-frame bright component must not hide a valid higher-threshold paper crop', () => {
  const width = 200, height = 300, pixels = new Uint8Array(width * height).fill(160);
  for (let y = 30; y < 270; y++) for (let x = 40; x < 160; x++) pixels[y * width + x] = 245;
  const paper = findPaper({ width, height, pixels });
  assert.ok(paper);
  assert.ok(paper.left > 20 && paper.right < 180);
  assert.ok(paper.top > 10 && paper.bottom < 290);
});
test('rejects URLs, invalid RGBA and oversized images', async () => {
  await assert.rejects(decodeImage('https://example.com/receipt.jpg'), TypeError);
  await assert.rejects(decodeImage({ width: 2, height: 2, data: new Uint8Array(3) }), RangeError);
  assert.throws(() => validateDimensions(10000, 10000), RangeError);
  assert.throws(() => validateDimensions(-1, 20), RangeError);
});
test('paper detection bridges thin printed separator rules instead of truncating the receipt', () => {
  const width = 200, height = 300, pixels = new Uint8Array(width * height).fill(100);
  for (let y = 25; y < 280; y++) for (let x = 40; x < 160; x++) pixels[y * width + x] = y >= 150 && y < 153 ? 0 : 245;
  const paper = findPaper({ width, height, pixels });
  assert.ok(paper.top < 30 && paper.bottom > 275);
});
