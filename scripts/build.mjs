import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const prefix = await readFile('vendor/core-prefix.js', 'utf8');
const model = await readFile('vendor/eng.traineddata.gz.base64', 'utf8');
const provenance = JSON.parse(await readFile('vendor/provenance.json', 'utf8'));
if (createHash('sha256').update(prefix).digest('hex') !== provenance.corePrefixSHA256 ||
    createHash('sha256').update(Buffer.from(model, 'base64')).digest('hex') !== provenance.modelGzipSHA256) {
  throw new Error('Vendored engine/model hash mismatch');
}
const result = await build({
  entryPoints: ['src/index.js'], bundle: true, write: false, format: 'iife',
  globalName: 'ReceiptOCR', target: 'es2020', minify: false,
  define: { __EMBEDDED_MODEL__: JSON.stringify(model) },
});
await writeFile('receipt-ocr.js', prefix + '\n// Modified wrapper: photo preprocessing and key-field extraction (2026).\n' + result.outputFiles[0].text + '\nglobal.ReceiptOCR = ReceiptOCR;\n})(globalThis);\n');
console.log('Built self-contained receipt-ocr.js; original engine and model hashes verified.');
