// One-time extraction from the user-supplied single-file distribution.
// This preserves the engine bytes and the original embedded model, not sample data.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (!process.argv[2]) throw new Error('Usage: node scripts/extract-vendor.mjs path/to/original-receipt-ocr.js (not the rebuilt output)');
const original = await readFile(process.argv[2], 'utf8');
const marker = original.lastIndexOf('var ReceiptOCR=');
if (marker < 0) throw new Error('Original distribution wrapper not found');
const model = original.slice(marker).match(/"(H4sI[A-Za-z0-9+/=]+)"/);
if (!model) throw new Error('Embedded model not found');
await mkdir('vendor', { recursive: true });
await writeFile('vendor/core-prefix.js', original.slice(0, marker));
await writeFile('vendor/eng.traineddata.gz.base64', model[1]);
await writeFile('vendor/provenance.json', JSON.stringify({
  originalSHA256: createHash('sha256').update(original).digest('hex'),
  corePrefixSHA256: createHash('sha256').update(original.slice(0, marker)).digest('hex'),
  modelGzipSHA256: createHash('sha256').update(Buffer.from(model[1], 'base64')).digest('hex'),
}, null, 2) + '\n');
