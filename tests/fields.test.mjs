import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignAmounts, headingAnchors, selectFinancialFields, amountRegions } from '../src/fields.js';

test('matches labels and prices with a consistent baseline offset', () => {
  const headings = [100, 140, 200].map((center, i) => ({ center, height: 20, type: ['subtotal', 'tax', 'total'][i] }));
  const prices = [125, 165, 225].map(center => ({ center, right: 400 }));
  const aligned = alignAmounts(headings, prices).filter(a => a.alignment === 0);
  assert.deepEqual(aligned.map(a => a.region.center - a.anchor.center), [25, 25, 25]);
});
test('distinguishes Total Tax and Sub Total from the primary total', () => {
  const word = (text, left) => ({ text, left, top: 100, width: 40, height: 20, confidence: 90 });
  const rows = [{ words: [word('Total', 24), word('Tax', 70)] }, { words: [{ ...word('Sub', 24), top: 150 }, { ...word('Total', 70), top: 150 }] }];
  assert.deepEqual(headingAnchors(rows).map(h => h.type), ['tax', 'subtotal']);
});
function result(pass, total, confidence = 90) {
  return { pass, total, tax: 1.08, subtotal: 13.50, confidence, evidence: {}, tip: null, serviceCharge: null, discount: null };
}
test('validates against observed subtotal and tax without manufacturing a total', () => {
  const old = result('page', 14.38);
  const focused = { ...result('heading:gray:0', 14.58, 72), _fieldReadings: [{ type: 'total', support: 3, confidence: 72, cost: .1 }] };
  assert.equal(selectFinancialFields([old, focused], old).total.cents, 1458);
  assert.equal(selectFinancialFields([old], old).total.cents, 1438);
  assert.equal(selectFinancialFields([{ ...old, total: null }], old).total, null);
});
test('one distant menu price cannot justify shifting a financial label column', () => {
  const anchors = [{ type: 'tax', center: 200, height: 20 }];
  const regions = [{ center: 160, right: 400 }];
  assert.ok(!alignAmounts(anchors, regions).some(a => a.cost < .5));
});
test('payment labels guard against assigning tendered cash to Total', () => {
  const labels = [100, 150, 190, 230].map((center, i) => ({ center, height: 24, type: ['tax', 'total', 'payment', 'payment'][i] }));
  const prices = [102, 153, 191, 231].map(center => ({ center, right: 400 }));
  const best = alignAmounts(labels, prices).filter(a => a.alignment === 0);
  assert.equal(best.find(a => a.anchor.type === 'total').region.center, 153);
});
test('tax ranking does not impose a hard tax-rate cap or substitute a common rate', () => {
  const printed = { ...result('printed', 100, 80), subtotal: 40, tax: 60 };
  const wrong = { ...printed, pass: 'other', confidence: 99, tax: 6 };
  assert.equal(selectFinancialFields([printed, wrong], printed).tax.cents, 6000);
});
test('finds number glyph groups independently of the label row', () => {
  const image = { width: 160, height: 120, pixels: new Uint8Array(160 * 120).fill(240) };
  for (const top of [20, 60]) for (const left of [70, 83, 99]) for (let y = top; y < top + 18; y++) for (let x = left; x < left + 6; x++) image.pixels[y * 160 + x] = 20;
  const regions = amountRegions(image, { left: 50, top: 0, right: 140, bottom: 110 }, 20);
  assert.equal(regions.length, 2);
  assert.ok(regions[0].top < 20 && regions[1].top < 60);
});
