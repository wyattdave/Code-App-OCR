# ReceiptOCR — local JavaScript receipt recognition

**Work in progress: the supplied 200-photo acceptance set does not yet pass.**
Do not treat returned values as verified financial data. `needsReview` remains
`true`, including when arithmetic agrees.
The current v1.2 strict evaluation passes 61/200 receipts across all five fields.
Visible Total, Tax and Date accuracy is 160/196, 156/186 and 154/186 respectively; see
[`reports/validation.md`](reports/validation.md) and `reports/latest.json`.
The [paired comparison](reports/comparison.md) lists improvements and regressions
against v1.1 using identical corrected labels.

## Power Apps Code App integration

Deploy **`receipt-ocr.js`** with your app and retain the accompanying licensing
notices. It contains the JavaScript OCR engine, English model, decompressor,
image processing, and parser. No runtime package installation, model download,
CDN, service, API key, WebAssembly, or worker is required.
The historical core contains a local JavaScript compatibility shim with
WebAssembly-like names; it does not require the browser's native WebAssembly
API. The integration test explicitly removes that API before loading the script.

```ts
// Import the local artifact for its global registration (for example with Vite).
import './receipt-ocr.js';

const result = await globalThis.ReceiptOCR.recognize(file, {
  quality: 'photo',
  // Set this only when the source's date convention is known.
  dateOrder: 'MDY',
  onProgress: ({ status, progress }) => console.log(status, progress),
});

console.log(result.merchant, result.date, result.dateRaw);
console.log(result.currency, result.currencySymbol, result.tax, result.total);
console.log(result.warnings, result.evidence);
```

Place `receipt-ocr.d.ts` alongside the script for TypeScript global declarations.
Input may be a PNG/JPEG/WebP/BMP `File`/`Blob`, base64 image data URL, canvas,
decoded image, or `{ width, height, data }` RGBA object. HTTP URLs and file paths
are deliberately rejected. PDFs and SVGs are not supported.

Existing entry points remain: `init()`, `recognize()`, `parse(text)`, `dispose()`,
and `info`. Calls are serialized to protect engine memory. Initialization is
lazy; dispose when the app no longer needs OCR.

### Options and results

- `quality: 'photo'` (default): paper-region candidate, small-angle deskew,
  upscaling, local illumination correction, alternative layouts, isolated
  heading/amount-column recognition, and header recognition. Total, Tax and
  Subtotal are located geometrically; the compact summary is re-read, then
  numeric glyph groups are recognized at a normalized height with alternative
  thresholding and aspect ratios. Only actually observed values are considered.
  Subtotal/tax arithmetic validates candidates; it never supplies missing digits.
  The unmodified image is also tried, so an incorrect crop cannot be the only
  source of evidence.
- `quality: 'fast'`: one document pass; lower latency, lower photo accuracy.
- `maxDimension`: 400–3200; default 2400. Applies before adding a white border
  and any small-angle rotation. Input limit: 20 MiB / 40 megapixels.
- `pageSegMode`: optional 3, 6, or 11 to override document segmentation.
- `dateOrder`: `MDY` or `DMY`. Otherwise ambiguous dates retain `dateRaw` but
  return `date: null`. Dates that can be resolved are ISO `YYYY-MM-DD`.
- `debug: true`: includes each attempt's recognized text and word coordinates.
  This increases result size and contains receipt data; do not log it in production.
- `confidence` is the engine's **overall text** score, not a calibrated
  probability that the merchant/date/amounts are correct.
- `evidence` records the observed lines and, for recovered fields, the source
  pass. `rawText` belongs to the selected pass; other passes may contribute a
  missing field. Whitespace around existing decimal punctuation may be joined;
  absent decimal punctuation or digits are never inserted.
- `$` does **not** establish USD, and `¥` does not distinguish JPY from CNY.
  `currency` is left null without sufficient evidence. Currency-symbol and
  currency-code fields are deliberately separate.
- `currencyFamily` exposes dollar, pound, euro, yen/yuan, won and peso families
  from recognized symbols or explicit codes. `₱`/PHP and MXN map to peso;
  CNY/RMB/元 to yuan, JPY/円 to yen, and KRW/₩ to won. `¥` alone remains
  `yen-or-yuan`. These are recognized-text formats, not a multilingual model
  upgrade; a symbol that the OCR cannot read still needs review.
- Tax, subtotal, tip, service charge, discount, and total remain observed values.
  Arithmetic checks help select evidence, but never manufacture a total or tax.

Recognition runs synchronously inside the JavaScript engine on the caller's
thread, despite the promise API. Multi-pass photo processing can take many
seconds. It yields between passes for progress/UI repaint, but each individual
OCR pass still blocks rendering. No background worker compatibility is claimed.

## Build and test

Node.js 22+ is used for development:

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run benchmark -- --workers=4 --output=test-results/financial-v1.2.json
npm run evaluate -- test-results/financial-v1.2.json reports/latest.json
```

The browser harness currently uses installed Microsoft Edge. Playwright and
esbuild are development-only. `fflate` is bundled into the output; it does not
remain an external runtime import. The original engine/model bytes are pinned
and verified against `vendor/provenance.json` during every build.

`npm run test:browser` creates new synthetic receipts, including a skewed image,
and checks recognition, concurrent calls, recovery after invalid input, and
disposal. It disables the global WebAssembly API, intercepts network/worker
APIs, and uses a restrictive CSP with no connection or worker permission.
This is a local browser test, **not** a deployment test in your Power Apps tenant.
Both classic-script loading and strict ESM side-effect imports are tested.

For an individual photograph's preprocessing stages:

```sh
node scripts/inspect-image.mjs large-receipt-image-dataset-SRD/1000-receipt.jpg
```

## Acceptance testing and limitations

`tests/expected.csv` contains provisional, manually transcribed key fields for
**all 200 supplied files**. It is evaluation-only and is never imported into the
runtime or build. Review annotations, especially dates, split payments,
handwriting, and missing fields, before using them as an acceptance contract.
`tests/expected.csv` is the single authoritative test inventory. Printed labelled
totals take precedence over separate handwritten annotations, as clarified by
the user. Three previous labels mixed those up; old and new results must be
rescored against the same corrected labels before comparing accuracy.

`scripts/evaluate.mjs` compares exact monetary cents, exact dates and symbols,
and merchant names ignoring only case, punctuation and diacritics. Missing
results, wrong non-null values, and invented values for unavailable fields fail.
It reports visible-field correctness separately so blank fields cannot inflate
the useful recognition rate. It exits nonzero unless **every** receipt passes.
`node scripts/compare-reports.mjs reports/previous-relabelled.json reports/latest.json`
generates a paired comparison, including gains and regressions, and refuses
reports scored against different labels or image inventories. The benchmark
sets `dateOrder: 'MDY'`; this convention is not inferred from a currency symbol.

The existing corpus has been used for development and regression testing; it
is not an independent holdout. Passing it would not establish universal
receipt accuracy. New, separately collected photos are needed for that claim.
There are no image hashes, filename lookups, expected amounts, merchant lists,
or receipt templates in the runtime.

To reproduce the original baseline, run `npm run build:baseline`, then run the
benchmark with `--script=test-results/receipt-ocr-baseline.js`. This reconstructs
the user-supplied original artifact byte-for-byte and verifies its original hash.
The historical wrapper in `tests/fixtures/` is not used by the improved runtime.

Known hard cases remain:

- Handwritten final totals, highly condensed text, perspective distortion,
  folded paper, glare, and very low resolution (some photos are only 258×258).
- Cropped/covered merchant names or totals, and genuinely blank final totals.
  Unavailable information cannot be recovered honestly from those pixels.
- Multiple currencies, ambiguous dates, split checks, and repeated tax/seat
  summaries. These require review; arithmetic agreement alone is insufficient.
- The embedded model is an English printed-text model, not a handwriting model
  or a universally multilingual receipt model.

The historical compiled engine and its native-library ancestry still require
organizational security/license review. See `NOTICE.txt`,
`THIRD-PARTY-NOTICES.txt`, and `licenses/`.
