# Validation status: NOT COMPLETE

The acceptance objective is **all 200 supplied photos**, with correct merchant,
date, currency evidence, tax, and total. Passing unit tests or merely returning
non-null amounts does not satisfy it.

## Test method

- `tests/expected.csv`: provisional manual readings of every supplied image.
  Punctuation/case/diacritics are ignored for merchant comparison; monetary
  values must match exact cents. Missing/unavailable fields are not invented.
- Printed labelled totals take precedence over separate handwritten amounts.
  Three corrected primary-total labels are applied to all versions before
  comparison. Split-check and blank-total cases remain in the evaluation.
- `scripts/evaluate.mjs` requires every image and every key field to pass,
  otherwise exits nonzero. It reports correct visible values separately from
  nulls for unavailable information.
- No expected values, receipt filenames, image hashes, or merchant dictionary
  are used by recognition. Fixtures and evaluation code are outside the build.
- These are development/regression results, **not** an independent holdout or
  proof of accuracy on all future receipts. The manual labels also need review.

## Runtime constraint checks

37 unit/regression tests pass. Browser integration tests pass with:

- The native global WebAssembly API removed before the script loads.
- Fetch, XHR, WebSocket, and Worker APIs replaced with throwing sentinels.
- A CSP forbidding network connections and workers, with no unsafe-eval grant.
- Both classic-script and strict ESM imports.
- Previously unseen synthetic receipts, skew, concurrent callers, recovery
  after invalid input, initialization, and disposal.

The rebuilt distribution retains the original JavaScript engine and English
model. Hashes are recorded in `vendor/provenance.json`; the uncompressed model
matches `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.
The original artifact is reproducible with `npm run build:baseline`.

This has **not** been deployed or tested inside the user's Power Apps tenant.

## Results

The original artifact recognized exact totals on **39/196** photos with a
visible final total and exact tax on **48/186** with a visible tax amount.
It had no merchant or date extraction API.

Final distribution: all **200 photos processed**, with no runtime exceptions.
Only **61/200 receipts** pass all five strict key-field checks. Acceptance fails.
Total and Tax both pass on **145/200**; Total, Tax and Date all pass on **125/200**.
These receipt-level counts include correctly null unavailable fields.

| Field | v1.2 correct visible | v1.1, rescored | Original artifact | v1.2 passes including correct nulls |
| --- | ---: | ---: | ---: | ---: |
| Merchant | 89/194 | 87/194 | Not implemented | 89/200 |
| Date | 154/186 | 148/186 | Not implemented | 164/200 |
| Currency symbol | 98/102 | 96/102 | 55/102 | 178/200 |
| Tax | 156/186 | 142/186 | 48/186 | 170/200 |
| Final total | 160/196 | 145/196 | 39/196 | 163/200 |

Unavailable fields are excluded from the visible-field denominators, not from
the 200-receipt acceptance check. Six merchant false positives, four dates on
ambiguous/unavailable date labels, eighteen currency-symbol false positives, and one
total on an unavailable-total label are also recorded. Review the provisional
annotations before treating these as final statistical accuracy measurements.

Compared with v1.1, Total gained 18 passes and regressed on 3 receipts; Tax gained
17 and regressed on 3; Date gained 8 and regressed on 2. Currency recognition
improved on visible symbols but produced 8 additional false positives where no
symbol was labelled, reducing overall currency-field passes from 184 to 178.
See `reports/comparison.md` for the exact gain/regression inventory.

The extra reads cost time: median per-photo processing increased from 13.9 to
33.2 seconds, and p95 from 23.5 to 56.6 seconds, with four parallel browser
instances. These include CPU contention and are not single-user guarantees.

`reports/latest.json` includes the distribution SHA-256 and every per-image
difference; `reports/baseline.json` records the original comparison. Final
distribution SHA-256:
`fe7480a14494322aa82f57715ef2e963038b2ff7de9a884020aee9e1fa11e566`.
The saved run contains 200 unique records with no exceptions, scored using
`dateOrder: 'MDY'`. The original run's final save completed with all 200 records;
a separate one-receipt diagnostic rerun is not used in these results.

## Remaining engineering work

The remaining failures are not all attributable to bad inputs. They include:

- Merchant selection: item descriptions or receipt metadata can still be
  mistaken for the merchant when the real header is unreadable or absent.
- Condensed/double-height total fonts and low-resolution digits.
- Perspective-dependent label/amount association and multi-column tax tables.
- Handwritten final totals: the embedded printed-English model is insufficient.
- Cropped/covered fields and genuinely blank totals: require unavailable-field
  handling or better source images, not calculated replacement values.
- Ambiguous date order and currency codes: require reliable context or explicit
  caller settings, not assumptions based on a dollar sign.

`needsReview` remains true. This is not approved for unattended financial entry
and the all-receipts objective has not been declared complete.
