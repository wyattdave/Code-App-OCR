// Compare paired evaluations only after scoring both against identical labels.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const [beforePath, afterPath, output = 'reports/comparison.md'] = process.argv.slice(2);
if (!afterPath) throw new Error('Usage: node scripts/compare-reports.mjs before.json after.json [output.md]');
const before = JSON.parse(await readFile(beforePath, 'utf8')), after = JSON.parse(await readFile(afterPath, 'utf8'));
if (!before.summary.labelsSHA256 || before.summary.labelsSHA256 !== after.summary.labelsSHA256) throw new Error('Both reports must be rescored with identical ground-truth labels.');
if (before.summary.processed !== before.summary.datasetImages || after.summary.processed !== after.summary.datasetImages) throw new Error('Comparison requires full-corpus runs.');
const inventory = report => report.receipts.map(r => r.file).sort();
const beforeFiles = inventory(before), afterFiles = inventory(after);
if (beforeFiles.length !== before.summary.datasetImages || afterFiles.length !== after.summary.datasetImages ||
    new Set(beforeFiles).size !== beforeFiles.length || new Set(afterFiles).size !== afterFiles.length ||
    JSON.stringify(beforeFiles) !== JSON.stringify(afterFiles)) throw new Error('Comparison requires the same complete, unique image inventory.');
if (Object.keys(before.summary.fields).some(field => before.summary.fields[field].visible !== after.summary.fields[field]?.visible)) throw new Error('Visible-field denominators must match.');
const names = { total: 'Total', tax: 'Tax', date: 'Date', currencySymbol: 'Currency symbol', merchant: 'Merchant' };
const lines = ['# Paired full-set comparison', '',
  'Both versions were evaluated against the same provisional manual labels. Printed labelled totals take precedence over separate handwritten annotations. Label corrections are not counted as OCR improvements.', '',
  '| Visible field | Before | After | Change |', '| --- | ---: | ---: | ---: |'];
for (const [field, name] of Object.entries(names)) {
  const a = before.summary.fields[field], b = after.summary.fields[field];
  const delta = b.visibleCorrect - a.visibleCorrect;
  lines.push(`| ${name} | ${a.visibleCorrect}/${a.visible} | ${b.visibleCorrect}/${b.visible} | ${delta > 0 ? '+' : ''}${delta} |`);
}
lines.push('', `- Total and Tax both pass: **${before.summary.totalAndTaxPasses} → ${after.summary.totalAndTaxPasses}/${after.summary.datasetImages}**.`,
  `- Total, Tax and Date all pass: **${before.summary.totalTaxDatePasses} → ${after.summary.totalTaxDatePasses}/${after.summary.datasetImages}**.`,
  `- All five fields pass: **${before.summary.receiptPasses} → ${after.summary.receiptPasses}/${after.summary.datasetImages}**.`,
  `- Overall acceptance: **${after.summary.status}**.`, '', '## Field-level gains and regressions', '', 'IDs correspond to `<ID>-receipt.jpg`.');
if (before.summary.processingMs && after.summary.processingMs) {
  const seconds = ms => (ms / 1000).toFixed(1);
  lines.splice(lines.indexOf('## Field-level gains and regressions'), 0,
    `Median per-photo processing: **${seconds(before.summary.processingMs.median)}s → ${seconds(after.summary.processingMs.median)}s**; p95: **${seconds(before.summary.processingMs.p95)}s → ${seconds(after.summary.processingMs.p95)}s**. These parallel-browser measurements include CPU contention and are not single-user latency guarantees.`, '');
}
const old = new Map(before.receipts.map(r => [r.file, r]));
for (const field of ['total', 'tax', 'date']) {
  const failed = (r, f) => !r?.tested || r.error || r.differences.some(d => d.field === f);
  const gained = after.receipts.filter(r => failed(old.get(r.file), field) && !failed(r, field)).map(r => r.file.replace('-receipt.jpg', ''));
  const lost = after.receipts.filter(r => !failed(old.get(r.file), field) && failed(r, field)).map(r => r.file.replace('-receipt.jpg', ''));
  lines.push('', `### ${names[field]}`, '', `New passes (${gained.length}): ${gained.join(', ') || 'none'}.`, '', `Regressions (${lost.length}): ${lost.join(', ') || 'none'}.`);
}
lines.push('', '## Reproducibility', '', `- Before distribution SHA-256: \`${before.summary.run.scriptSHA256}\`.`, `- After distribution SHA-256: \`${after.summary.run.scriptSHA256}\`.`, `- Label SHA-256: \`${after.summary.labelsSHA256}\`.`, '', 'These are development/regression measurements, not an independent holdout or a guarantee for all future receipts.');
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, lines.join('\n') + '\n');
console.log(output);
