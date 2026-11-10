// Strict, offline scoring. The OCR runtime never reads this file or the labels.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const input = process.argv[2] || 'test-results/latest.json';
const output = process.argv[3] || input.replace(/\.json$/, '-evaluation.json');
const records = (await readFile('tests/expected.csv', 'utf8')).trim().split(/\r?\n/).slice(1).map(line => {
  const [file, merchant, date, currencySymbol, tax, total, ...notes] = line.split(',');
  return { file, merchant: merchant || null, date: date || null, currencySymbol: currencySymbol || null,
    tax: tax === '' ? null : Number(tax), total: total === '' ? null : Number(total), notes: notes.join(',') };
});
const files = (await readdir('large-receipt-image-dataset-SRD')).filter(f => /\.jpg$/i.test(f));
if (new Set(records.map(r => r.file)).size !== files.length || files.some(f => !records.some(r => r.file === f))) throw new Error('Ground truth must cover each supplied image exactly once.');
const results = JSON.parse(await readFile(input, 'utf8'));
if (!Array.isArray(results)) throw new Error('Benchmark results must be an array.');
if (new Set(results.map(r => r.file)).size !== results.length || results.some(r => !files.includes(r.file))) throw new Error('Benchmark contains duplicate or unknown image records.');
const byFile = new Map(results.map(r => [r.file, r]));
const fields = ['merchant', 'date', 'currencySymbol', 'tax', 'total'];
const normalize = value => value == null ? null : String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (field, a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (field === 'merchant') return normalize(a) === normalize(b);
  if (field === 'tax' || field === 'total') return Math.round(a * 100) === Math.round(b * 100);
  return a === b;
};
const evaluated = records.map(expected => {
  const actual = byFile.get(expected.file);
  const differences = fields.filter(f => !actual || actual.error || !matches(f, actual[f], expected[f]))
    .map(field => ({ field, expected: expected[field], actual: actual?.[field] ?? null }));
  return { file: expected.file, tested: !!actual, passed: !!actual && !actual.error && differences.length === 0,
    differences, notes: expected.notes, ...(actual?.error ? { error: actual.error } : {}) };
});
const timings = results.filter(r => !r.error && Number.isFinite(r.processingMs)).map(r => r.processingMs).sort((a, b) => a - b);
const summary = {
  status: evaluated.every(r => r.passed) ? 'PASS' : 'NOT COMPLETE',
  annotationStatus: 'Provisional manual transcription; ambiguous and obscured fields noted in tests/expected.csv. User review still required.',
  labelsSHA256: createHash('sha256').update(await readFile('tests/expected.csv')).digest('hex'),
  input, datasetImages: files.length, processed: results.length, receiptPasses: evaluated.filter(r => r.passed).length,
  totalAndTaxPasses: evaluated.filter(r => r.tested && !r.error && !r.differences.some(d => ['total', 'tax'].includes(d.field))).length,
  totalTaxDatePasses: evaluated.filter(r => r.tested && !r.error && !r.differences.some(d => ['total', 'tax', 'date'].includes(d.field))).length,
  errors: results.filter(r => r.error).length,
  ...(timings.length ? { processingMs: { count: timings.length, median: timings.length % 2 ? timings[(timings.length - 1) / 2] : (timings[timings.length / 2 - 1] + timings[timings.length / 2]) / 2,
    p95: timings[Math.ceil(timings.length * .95) - 1], min: timings[0], max: timings.at(-1) } } : {}),
  ...await readFile(input.replace(/\.json$/, '.run.json'), 'utf8').then(text => ({ run: JSON.parse(text) })).catch(() => ({})),
  fields: Object.fromEntries(fields.map(field => [field, {
    correct: records.filter(e => { const a = byFile.get(e.file); return a && !a.error && matches(field, a[field], e[field]); }).length,
    visible: records.filter(e => e[field] !== null).length,
    visibleCorrect: records.filter(e => { const a = byFile.get(e.file); return e[field] !== null && a && !a.error && matches(field, a[field], e[field]); }).length,
    falsePositivesOnUnavailableFields: records.filter(e => e[field] === null && byFile.get(e.file)?.[field] != null).length,
  }]))
};
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify({ summary, receipts: evaluated }, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, ...(summary.run ? { run: { ...summary.run, files: undefined, fileCount: summary.run.files?.length } } : {}) }, null, 2));
// Partial processing or wrong values must never be reported as a successful run.
if (summary.status !== 'PASS') process.exitCode = 1;
