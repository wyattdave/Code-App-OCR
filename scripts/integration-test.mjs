// Development-only integration tests, including a restrictive browser CSP and
// synthetic receipts that are not members of the supplied sample collection.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const script = await readFile('receipt-ocr.js');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; img-src data: blob:; connect-src 'none'; worker-src 'none'; style-src 'none'");
  res.setHeader('Content-Type', req.url === '/ocr.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/ocr.js' ? script : `<!doctype html><title>Offline OCR tests</title><script ${req.url === '/module' ? 'type="module"' : ''} src="/ocr.js"></script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const external = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith(origin + '/')) { external.push(url); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    window.WebAssembly = undefined;
    window.forbiddenCalls = [];
    for (const name of ['fetch', 'XMLHttpRequest', 'Worker', 'WebSocket']) {
      window[name] = function () { window.forbiddenCalls.push(name); throw new Error(`${name} forbidden`); };
    }
  });
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    function receipt(name, subtotal, tax, total, angle = 0) {
      const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 1300;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#aaa'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(550, 650); ctx.rotate(angle * Math.PI / 180); ctx.translate(-500, -590);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 1180);
      ctx.fillStyle = '#111'; ctx.font = 'bold 42px Arial'; ctx.fillText(name, 65, 100);
      ctx.font = '30px Arial'; ctx.fillText('481 Example Road', 65, 160);
      ctx.fillText('2024-09-18 14:35', 65, 220);
      ctx.fillText('Soup', 65, 400); ctx.fillText(subtotal, 760, 400);
      ctx.fillText('Subtotal', 65, 600); ctx.fillText(subtotal, 760, 600);
      ctx.fillText('Sales Tax', 65, 660); ctx.fillText(tax, 760, 660);
      ctx.font = 'bold 40px Arial'; ctx.fillText('TOTAL', 65, 770); ctx.fillText('$' + total, 740, 770);
      ctx.font = '30px Arial'; ctx.fillText('Cash tendered', 65, 850); ctx.fillText('50.00', 760, 850);
      ctx.fillText('Change', 65, 910); ctx.fillText((50 - Number(total)).toFixed(2), 760, 910);
      ctx.font = '30px Arial'; ctx.fillText('Thank you', 65, 1020);
      return canvas;
    }
    await ReceiptOCR.init();
    let rejected = false;
    try { await ReceiptOCR.recognize('https://example.invalid/private-receipt.jpg'); } catch { rejected = true; }
    const a = receipt('LARCHWOOD MARKET', '17.50', '1.40', '18.90');
    const b = receipt('FIELDSTONE CAFE', '23.00', '1.84', '24.84');
    // Concurrent callers must not overwrite each other's engine buffers.
    const clean = await Promise.all([a, b].map(image => ReceiptOCR.recognize(image, { quality: 'fast', pageSegMode: 6 })));
    const skewed = await ReceiptOCR.recognize(receipt('CEDAR GROVE KITCHEN', '31.00', '2.48', '33.48', 5));
    await ReceiptOCR.dispose();
    return { rejected, clean, skewed, forbidden: window.forbiddenCalls, wasm: typeof window.WebAssembly };
  });
  assert.equal(result.rejected, true);
  assert.equal(result.wasm, 'undefined');
  assert.deepEqual(result.forbidden, []);
  assert.deepEqual(external, []);
  for (const [receipt, merchant, total, tax] of [
    [result.clean[0], 'LARCHWOOD MARKET', 18.9, 1.4],
    [result.clean[1], 'FIELDSTONE CAFE', 24.84, 1.84],
    [result.skewed, 'CEDAR GROVE KITCHEN', 33.48, 2.48],
  ]) {
    assert.equal(receipt.merchant, merchant);
    assert.equal(receipt.total, total);
    assert.equal(receipt.tax, tax);
    assert.equal(receipt.date, '2024-09-18');
    assert.equal(receipt.currencySymbol, '$');
    assert.equal(receipt.needsReview, true);
  }
  await page.goto(origin + '/module');
  const moduleResult = await page.evaluate(async () => {
    await globalThis.ReceiptOCR.init();
    const parsed = globalThis.ReceiptOCR.parse('EXAMPLE MARKET\n2024-09-18\nTAX 1.00\nTOTAL 11.00');
    await globalThis.ReceiptOCR.dispose();
    return { parsed, forbidden: window.forbiddenCalls };
  });
  assert.equal(moduleResult.parsed.total, 11);
  assert.deepEqual(moduleResult.forbidden, []);
  assert.deepEqual(external, []);
  console.log('PASS: unseen synthetic receipts, skew, concurrent calls, error recovery, disposal, classic and ESM imports, CSP, no WASM, no workers, no network.');
} finally { await browser.close(); server.close(); }
