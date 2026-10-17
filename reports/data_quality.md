# Data-quality findings

Profiled on 17 Oct 2026. Source: `COMPLAINTS_RECEIVED_2020-2024.txt`, `COMPLAINTS_RECEIVED_2025-2026.txt`, `FLAT_RCL_POST_2010.txt` in `data/raw/`, before the START_YEAR filter.

## Complaints

- Rows: 624,005; distinct complaints (ODINO): 429,456. One complaint can list several components, so a row is complaint x component.
- Duplicate row IDs (CMPLID): 0
- Missing received date (LDATE): 0 (0.0%); staging falls back to DATEA.
- Model year recorded as 9999 (unknown): 9,073 (1.5%); staging sets these to null.
- Make spellings: 869 raw values collapse to 868 after trimming and upper-casing; staging standardises them.
- Vehicle complaints (PROD_TYPE = V): 615,465 (98.6%); the rest are tires, child seats and equipment, which the marts leave out.
- Distinct component descriptions: 719, in 52 top-level groups (used for signals).

## Recalls

- Rows: 246,109; distinct campaigns: 15,319 (a campaign covers several model years, one row each).
- Missing report date (RCDATE): 0
- Filed from 2020 on (what load.py keeps): 181,170 rows, of which vehicle recalls (RCLTYPECD = V): 157,613
