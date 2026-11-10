import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('distribution preserves the original engine bytes and does not contain test fixtures', async () => {
  const prefix = await readFile('vendor/core-prefix.js');
  const provenance = JSON.parse(await readFile('vendor/provenance.json', 'utf8'));
  assert.equal(createHash('sha256').update(prefix).digest('hex'), provenance.corePrefixSHA256);
  const script = await readFile('receipt-ocr.js', 'utf8');
  assert.ok(script.startsWith(prefix.toString()));
  assert.ok(!script.includes('large-receipt-image-dataset-SRD'));
  assert.ok(!script.includes('expected.csv'));
  assert.ok(!script.includes('ground-truth.json'));
  assert.ok(!script.includes('probe-entry.js'));
  assert.ok(!script.includes('__RECEIPT_BASELINE_MODEL__'));
});
test('manual labels cover all supplied photos exactly once', async () => {
  const files = (await readdir('large-receipt-image-dataset-SRD')).filter(file => /\.jpg$/i.test(file)).sort();
  const labels = (await readFile('tests/expected.csv', 'utf8')).trim().split(/\r?\n/).slice(1).map(row => row.split(',')[0]).sort();
  assert.deepEqual(labels, files);
});
