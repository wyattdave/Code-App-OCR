import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('paired reporting requires identical labels and complete unique image inventories', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/reporting-'));
  try {
    const fields = Object.fromEntries(['total', 'tax', 'date', 'currencySymbol', 'merchant'].map(f => [f, { visible: 1, visibleCorrect: 0 }]));
    const before = { summary: { labelsSHA256: 'same-labels', processed: 1, datasetImages: 1, fields,
      totalAndTaxPasses: 0, totalTaxDatePasses: 0, receiptPasses: 0, status: 'NOT COMPLETE', run: { scriptSHA256: 'old' } },
      receipts: [{ file: 'synthetic.jpg', tested: true, differences: [{ field: 'total' }] }] };
    const after = structuredClone(before);
    after.summary.fields.total.visibleCorrect = 1;
    after.summary.run.scriptSHA256 = 'new';
    after.receipts[0].differences = [];
    const oldPath = join(directory, 'before.json'), newPath = join(directory, 'after.json'), output = join(directory, 'comparison.md');
    await writeFile(oldPath, JSON.stringify(before));
    const compare = async value => {
      await writeFile(newPath, JSON.stringify(value));
      return spawnSync(process.execPath, ['scripts/compare-reports.mjs', oldPath, newPath, output], { encoding: 'utf8' });
    };
    assert.equal((await compare(after)).status, 0);
    const markdown = await readFile(output, 'utf8');
    assert.ok(markdown.includes('| Total | 0/1 | 1/1 | +1 |'));
    assert.ok(markdown.includes('New passes (1): synthetic.jpg.'));
    assert.notEqual((await compare({ ...after, summary: { ...after.summary, labelsSHA256: 'different' } })).status, 0);
    assert.notEqual((await compare({ ...after, receipts: [...after.receipts, ...after.receipts] })).status, 0);
    assert.notEqual((await compare({ ...after, receipts: [{ ...after.receipts[0], file: 'other.jpg' }] })).status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
