import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import http from 'node:http';
import { chromium } from 'playwright';
const [file, coordinates, mode = '7'] = process.argv.slice(2);
if (!coordinates) throw new Error('Usage: node scripts/probe.mjs photo.jpg left,top,right,bottom [segmentation-mode]');
const [left, top, right, bottom] = coordinates.split(',').map(Number);
const prefix = await readFile('vendor/core-prefix.js', 'utf8'), model = await readFile('vendor/eng.traineddata.gz.base64', 'utf8');
const bundle = await build({ entryPoints: ['scripts/probe-entry.js'], bundle: true, write: false, format: 'iife', globalName: 'Probe', target: 'es2020', define: { __EMBEDDED_MODEL__: JSON.stringify(model) } });
const script = prefix + bundle.outputFiles[0].text + '\nglobal.Probe=Probe;\n})(globalThis);';
const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/probe.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/probe.js' ? script : '<!doctype html><script src="/probe.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(); await page.addInitScript(() => { window.WebAssembly = undefined; });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const data = 'data:image/jpeg;base64,' + (await readFile(file)).toString('base64');
  const result = await page.evaluate(({ data, rect, mode }) => Probe.probe(data, rect, mode), { data, rect: { left, top, right, bottom }, mode: +mode });
  await mkdir('test-results/probes', { recursive: true });
  await writeFile(`test-results/probes/${file.replace(/.*[\\/]/, '')}-${coordinates}-${mode}.json`, JSON.stringify(result, null, 2));
  console.table(result);
} finally { await browser.close(); server.close(); }
