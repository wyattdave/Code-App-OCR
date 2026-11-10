// Reconstruct the exact user-supplied artifact for reproducible comparisons.
// This historical wrapper is test-only and is never included in the new build.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const prefix = await readFile('vendor/core-prefix.js', 'utf8');
const model = await readFile('vendor/eng.traineddata.gz.base64', 'utf8');
const wrapper = await readFile('tests/fixtures/baseline-wrapper.txt', 'utf8');
const provenance = JSON.parse(await readFile('vendor/provenance.json', 'utf8'));
const artifact = prefix + wrapper.replace('__RECEIPT_BASELINE_MODEL__', model);
if (createHash('sha256').update(artifact).digest('hex') !== provenance.originalSHA256) throw new Error('Baseline does not reproduce the exact original artifact');
await mkdir('test-results', { recursive: true });
await writeFile('test-results/receipt-ocr-baseline.js', artifact);
console.log('Reconstructed original receipt-ocr.js byte-for-byte; SHA-256 verified.');
