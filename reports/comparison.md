# Paired full-set comparison

Both versions were evaluated against the same provisional manual labels. Printed labelled totals take precedence over separate handwritten annotations. Label corrections are not counted as OCR improvements.

| Visible field | Before | After | Change |
| --- | ---: | ---: | ---: |
| Total | 145/196 | 160/196 | +15 |
| Tax | 142/186 | 156/186 | +14 |
| Date | 148/186 | 154/186 | +6 |
| Currency symbol | 96/102 | 98/102 | +2 |
| Merchant | 87/194 | 89/194 | +2 |

- Total and Tax both pass: **127 → 145/200**.
- Total, Tax and Date all pass: **104 → 125/200**.
- All five fields pass: **56 → 61/200**.
- Overall acceptance: **NOT COMPLETE**.

Median per-photo processing: **13.9s → 33.2s**; p95: **23.5s → 56.6s**. These parallel-browser measurements include CPU contention and are not single-user latency guarantees.

## Field-level gains and regressions

IDs correspond to `<ID>-receipt.jpg`.

### Total

New passes (18): 1002, 1009, 1015, 1019, 1025, 1035, 1054, 1055, 1062, 1073, 1076, 1104, 1121, 1122, 1137, 1172, 1196, 1199.

Regressions (3): 1030, 1044, 1168.

### Tax

New passes (17): 1047, 1052, 1054, 1055, 1056, 1067, 1070, 1095, 1105, 1108, 1116, 1128, 1145, 1156, 1162, 1182, 1196.

Regressions (3): 1034, 1041, 1114.

### Date

New passes (8): 1004, 1032, 1044, 1092, 1149, 1157, 1160, 1199.

Regressions (2): 1047, 1145.

## Reproducibility

- Before distribution SHA-256: `294320c8a5a49a41f48759994b2854422132a669fee3bc8ae8d6003bd24804a5`.
- After distribution SHA-256: `fe7480a14494322aa82f57715ef2e963038b2ff7de9a884020aee9e1fa11e566`.
- Label SHA-256: `b1d052b2ad8c2d932213759215fdd5bdc931a459aaba4720d404c40617ad7b38`.

These are development/regression measurements, not an independent holdout or a guarantee for all future receipts.
