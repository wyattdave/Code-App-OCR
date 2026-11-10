import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, moneyTokens } from '../src/parser.js';

test('extracts key fields from an unseen synthetic receipt', () => {
  const r = parse('ORCHARD KITCHEN\n42 Example Road\n2024-09-18 14:30\nSoup 7.50\nSubtotal 7.50\nSales Tax 0.60\nTOTAL: $8.10');
  assert.equal(r.merchant, 'ORCHARD KITCHEN');
  assert.equal(r.date, '2024-09-18');
  assert.equal(r.total, 8.1);
  assert.equal(r.tax, .6);
  assert.equal(r.arithmeticMatches, true);
  assert.equal(r.currencySymbol, '$');
  assert.equal(r.currency, null);
  assert.equal(r.needsReview, true);
});
test('handles decimal commas, thousands, labels with punctuation, and separated amounts', () => {
  const r = parse('NEW MERCHANT\n18/09/2024\nSubtotal 1.234,00\nVAT 20% 246,80\nTOTAL.\n€1.480,80');
  assert.equal(r.total, 1480.8);
  assert.equal(r.subtotal, 1234);
  assert.equal(r.tax, 246.8);
  assert.equal(r.currency, 'EUR');
  assert.equal(r.date, '2024-09-18');
  assert.equal(r.arithmeticMatches, true);
});
test('does not use tender, change, savings or suggested tips as total or tax', () => {
  const r = parse('EXAMPLE CAFE\nTax ID 123456.78\nCash Tendered 100.00\nChange 64.00\nTotal Savings 12.00\nSuggested Tip 6.00');
  assert.equal(r.total, null);
  assert.equal(r.tax, null);
  assert.equal(r.tip, null);
});
test('a menu item containing Tip is not a gratuity heading', () => {
  const r = parse('Steak Tip Skewers 11.00\nSubtotal 11.00\nTax .88\nTotal 11.88');
  assert.equal(r.tip, null); assert.equal(r.arithmeticMatches, true);
});
test('does not invent missing decimal digits or silently fix OCR amounts', () => {
  const r = parse('ANOTHER SHOP\nSubtotal 12.00\nTax l.20\nTOTAL $1320');
  assert.equal(r.total, null);
  assert.equal(r.tax, null);
});
test('supports labelled amount on the following line without using a later payment', () => {
  assert.equal(parse('TOTAL:\n$24.50\nCash 30.00').total, 24.5);
  assert.equal(parse('TOTAL:\nCash 30.00').total, null);
});
test('dates are validated and ambiguous numeric dates require dateOrder', () => {
  assert.equal(parse('SHOP\n02/03/2024').date, null);
  assert.equal(parse('SHOP\n02/03/2024', { dateOrder: 'MDY' }).date, '2024-02-03');
  assert.equal(parse('SHOP\n02/03/2024', { dateOrder: 'DMY' }).date, '2024-03-02');
  assert.equal(parse('SHOP\n2024-02-30').date, null);
  assert.equal(parse('SHOP\n18 Sep 2024').date, '2024-09-18');
  assert.equal(parse('SHOP\nSeptember 18, 2024').date, '2024-09-18');
});
test('does not sum explicit aggregate tax and its components twice', () => {
  const r = parse('State Tax 1.20\nLocal Tax 0.30\nTotal Tax 1.50\nTOTAL 20.00');
  assert.equal(r.tax, 1.5);
});
test('never reconciles by changing observed values', () => {
  const r = parse('Subtotal 10.00\nTax 1.00\nTOTAL 99.00');
  assert.equal(r.total, 99);
  assert.equal(r.arithmeticMatches, false);
});
test('negative amounts and comma thousands', () => {
  assert.equal(moneyTokens('-12.50')[0].cents, -1250);
  assert.equal(moneyTokens('$1,234.56')[0].cents, 123456);
  assert.equal(moneyTokens('8.25%').length, 0);
  assert.equal(moneyTokens('($12.50)')[0].cents, -1250);
  assert.equal(moneyTokens('-$12.50')[0].cents, -1250);
  assert.equal(moneyTokens('$12.50-')[0].cents, -1250);
  assert.equal(moneyTokens('($12.50').length, 0);
});
test('input limits and options remain enforced', () => {
  assert.throws(() => parse(null), TypeError);
  assert.throws(() => parse('x'.repeat(100001)), RangeError);
  assert.throws(() => parse('', { dateOrder: 'YMD' }), RangeError);
});
test('rejects partial amounts cut from longer OCR tokens', () => {
  assert.equal(parse('TOTAL $93,458').total, null);
  assert.equal(parse('TOTAL A6.73').total, null);
  assert.equal(parse('TAX l.20').tax, null);
});
test('accepts whitespace segmentation around decimal punctuation but never inserts it', () => {
  assert.equal(parse('TOTAL 36 .42').total, 36.42);
  assert.equal(parse('TOTAL 36. 42').total, 36.42);
  assert.equal(parse('TOTAL 36 42').total, null);
  assert.equal(parse('TAX .42').tax, .42);
});
test('French included VAT is not confused with the pre-tax value', () => {
  const r = parse('H.T. TVA 10% 20.00\nDONT TVA 10% 2.00\nTOTAL TTC 22.00\nEURO');
  assert.equal(r.tax, 2);
  assert.equal(r.total, 22);
  assert.equal(r.currency, 'EUR');
});
test('summed tax is not added a second time after per-seat taxes', () => {
  const r = parse('Tax 0.70\nTax 1.40\nSubtotal 30.00\nTax 2.10\nTOTAL 32.10');
  assert.equal(r.tax, 2.1);
});
test('includes explicitly printed fees and discounts in validation, not guessed amounts', () => {
  const r = parse('Subtotal 50.00\nDiscount -5.00\nTax 4.00\nService Charge 6.00\nTOTAL 55.00');
  assert.equal(r.total, 55);
  assert.equal(r.serviceCharge, 6);
  assert.equal(r.discount, -5);
  assert.equal(r.arithmeticMatches, true);
});
test('shortened till labels and Italian totals work without merchant-specific patterns', () => {
  assert.equal(parse('TXTL .80\nTOTL 10.80').total, 10.8);
  assert.equal(parse('TOTALE €18,00').total, 18);
  assert.equal(parse('Date: Jul19\'21').date, '2021-07-19');
});
test('printed labelled total remains primary over an unlabelled handwritten amount', () => {
  assert.equal(parse('Subtotal 80.00\nTax 8.00\nTotal $88.00\n98.00').total, 88);
});
test('common currency families distinguish symbols from ambiguous ISO codes', () => {
  for (const [text, family, code, total] of [
    ['Total $12.50', 'dollar', null, 12.5], ['Total £12.50', 'pound', 'GBP', 12.5],
    ['Total €12,50', 'euro', 'EUR', 12.5], ['Total ¥1,300', 'yen-or-yuan', null, 1300],
    ['Total ₩13000', 'won', 'KRW', 13000], ['Total ₱12.50', 'peso', 'PHP', 12.5],
    ['Total 12.50 MXN', 'peso', 'MXN', 12.5], ['Total 130元', 'yuan', 'CNY', 130],
  ]) {
    const r = parse(text); assert.equal(r.currencyFamily, family, text); assert.equal(r.currency, code, text); assert.equal(r.total, total, text);
  }
});
test('dates tolerate OCR token spacing and common month punctuation without guessed digits', () => {
  assert.equal(parse('Date: 05 / 18 / 2019').date, '2019-05-18');
  assert.equal(parse("MAR.19'17").date, '2017-03-19');
  assert.equal(parse('Date: 02 / 30 / 2019', { dateOrder: 'MDY' }).date, null);
});
