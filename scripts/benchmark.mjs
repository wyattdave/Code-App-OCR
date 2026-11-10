// Development-only browser harness. Images and results never leave localhost.
import http from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const root = resolve('.');
const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const script = resolve(option('script', 'receipt-ocr.js'));
const output = resolve(option('output', 'test-results/latest.json'));
const limit = Number(option('limit', '200'));
const workers = Number(option('workers', '2'));
if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw new RangeError('workers must be an integer from 1 to 8');
if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
const match = option('match', '');
const ids = new Set(option('ids', '').split(',').filter(Boolean).map(id => id.endsWith('.jpg') ? id : id + '-receipt.jpg'));
const files = (await readdir('large-receipt-image-dataset-SRD')).filter(f => /\.jpg$/i.test(f) && f.includes(match) && (!ids.size || ids.has(f))).sort().slice(0, limit);
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output.replace(/\.json$/, '.run.json'), JSON.stringify({
  startedAt: new Date().toISOString(), scriptSHA256: createHash('sha256').update(await readFile(script)).digest('hex'),
  files, workers, options: { dateOrder: 'MDY', debug: true }, nativeWebAssembly: false, runtimeNetwork: false, workersInRuntime: false,
}, null, 2));
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Local OCR benchmark</title><script src="/ocr.js"></script>');
    }
    const path = req.url === '/ocr.js' ? script : resolve(root, '.' + decodeURIComponent(req.url));
    if (req.url !== '/ocr.js' && relative(root, path).startsWith('..')) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', extname(path) === '.jpg' ? 'image/jpeg' : 'text/javascript');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
let next = 0;
let pendingSave = Promise.resolve();
const persist = () => {
  pendingSave = pendingSave.then(async () => {
    await writeFile(output, JSON.stringify([...results].sort((a, b) => a.file.localeCompare(b.file)), null, 2));
  });
  return pendingSave;
};
try {
  await Promise.all(Array.from({ length: workers }, async () => {
    const page = await browser.newPage();
    // Assert the runtime cannot use native WASM or make network requests.
    await page.addInitScript(() => {
      window.WebAssembly = undefined;
      window.fetch = () => { throw new Error('Runtime network access forbidden'); };
      window.XMLHttpRequest = class { constructor() { throw new Error('Runtime XHR forbidden'); } };
      window.Worker = class { constructor() { throw new Error('Runtime workers forbidden'); } };
    });
    await page.goto(origin);
    while (next < files.length) {
      const file = files[next++];
      try {
        const data = (await readFile(resolve('large-receipt-image-dataset-SRD', file))).toString('base64');
        const result = await page.evaluate(async data => ReceiptOCR.recognize('data:image/jpeg;base64,' + data, { dateOrder: 'MDY', debug: true }), data);
        results.push({ file, ...result });
        console.log(`${results.length}/${files.length} ${file} total=${result.total} tax=${result.tax} confidence=${result.confidence} ms=${result.processingMs}`);
      } catch (error) {
        results.push({ file, error: String(error) });
        console.error(file, String(error));
      }
      await mkdir(resolve(output, '..'), { recursive: true });
      await persist();
    }
    await page.close();
  }));
  await persist();
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ images: results.length, errors: results.filter(r => r.error).length, totalFound: results.filter(r => r.total != null).length, taxFound: results.filter(r => r.tax != null).length, output }, null, 2));
if (results.some(result => result.error)) process.exitCode = 1;
