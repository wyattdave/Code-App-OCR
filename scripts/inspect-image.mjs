// Local-only preprocessing diagnostics. No OCR ground truth is consulted.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { chromium } from 'playwright';
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/inspect-image.mjs path/to/photo.jpg');
const data = (await readFile(file)).toString('base64');
const root = resolve('.');
const server = http.createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>Local image diagnostics</title>'); }
  const path = resolve(root, '.' + req.url);
  if (relative(root, path).startsWith('..') || extname(path) !== '.js') { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async data => {
    const { decodeImage, crop, resize, findPaper, estimateSkew, rotate, normalizeLighting } = await import('/src/image.js');
    const original = await decodeImage('data:image/jpeg;base64,' + data);
    const rect = findPaper(original), paper = rect ? crop(original, rect) : original;
    const scale = Math.min(3, 2400 / Math.max(paper.width, paper.height));
    const scaled = scale > 1.05 ? resize(paper, Math.round(paper.width * scale), Math.round(paper.height * scale)) : paper;
    const angle = estimateSkew(scaled), straight = angle ? rotate(scaled, angle) : scaled;
    const stages = { original, scaled, straight, contrast: normalizeLighting(straight), binary: normalizeLighting(straight, true) };
    const images = {};
    for (const [name, image] of Object.entries(stages)) {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'), rgba = ctx.createImageData(image.width, image.height);
      for (let i = 0; i < image.pixels.length; i++) { rgba.data[i * 4] = rgba.data[i * 4 + 1] = rgba.data[i * 4 + 2] = image.pixels[i]; rgba.data[i * 4 + 3] = 255; }
      ctx.putImageData(rgba, 0, 0); images[name] = canvas.toDataURL('image/png').split(',')[1];
    }
    return { rect, angle, images };
  }, data);
  const output = `test-results/images/${file.replace(/.*[\\/]/, '').replace(/\.\w+$/, '')}`;
  await mkdir(output, { recursive: true });
  for (const [name, image] of Object.entries(result.images)) await writeFile(`${output}/${name}.png`, Buffer.from(image, 'base64'));
  console.log(JSON.stringify({ file, output, rect: result.rect, angle: result.angle }, null, 2));
} finally { await browser.close(); server.close(); }
