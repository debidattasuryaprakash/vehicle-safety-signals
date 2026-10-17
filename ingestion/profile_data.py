"""Profile the raw flat files and write a data-quality findings note.

Usage: python ingestion/profile_data.py  ->  reports/data_quality.md
"""
from datetime import date

import pandas as pd

from config import RAW_DIR, ROOT, SCHEMA, START_YEAR


def load(name):
    spec = SCHEMA[name]
    used = ["CMPLID", "ODINO", "MAKETXT", "YEARTXT", "COMPDESC", "LDATE", "PROD_TYPE",
            "RECORD_ID", "CAMPNO", "RCDATE", "RCLTYPECD"]
    return pd.concat(
        pd.read_csv(RAW_DIR / f["file"], sep="\t", header=None, names=spec["columns"],
                    usecols=lambda c: c in used, dtype=str, quoting=3,
                    encoding="latin-1", keep_default_na=False)
        for f in spec["files"])


def pct(n, d):
    return f"{n / d:.1%}" if d else "n/a"


def main():
    c, r = load("complaints"), load("recalls")
    n = len(c)
    make_raw = c["MAKETXT"].nunique()
    make_clean = c["MAKETXT"].str.strip().str.upper().nunique()
    lines = [
        "# Data-quality findings", "",
        f"Profiled on {date.today():%d %b %Y}. Source: "
        + ", ".join(f"`{f['file']}`" for n in ("complaints", "recalls") for f in SCHEMA[n]["files"])
        + " in `data/raw/`, before the START_YEAR filter.", "",
        "## Complaints", "",
        f"- Rows: {n:,}; distinct complaints (ODINO): {c['ODINO'].nunique():,}. "
        f"One complaint can list several components, so a row is complaint x component.",
        f"- Duplicate row IDs (CMPLID): {c['CMPLID'].duplicated().sum():,}",
        f"- Missing received date (LDATE): {(c['LDATE'] == '').sum():,} ({pct((c['LDATE'] == '').sum(), n)}); "
        "staging falls back to DATEA.",
        f"- Model year recorded as 9999 (unknown): {(c['YEARTXT'] == '9999').sum():,} "
        f"({pct((c['YEARTXT'] == '9999').sum(), n)}); staging sets these to null.",
        f"- Make spellings: {make_raw} raw values collapse to {make_clean} after trimming and "
        "upper-casing; staging standardises them.",
        f"- Vehicle complaints (PROD_TYPE = V): {(c['PROD_TYPE'] == 'V').sum():,} "
        f"({pct((c['PROD_TYPE'] == 'V').sum(), n)}); the rest are tires, child seats and equipment, "
        "which the marts leave out.",
        f"- Distinct component descriptions: {c['COMPDESC'].nunique():,}, "
        f"in {c['COMPDESC'].str.split(':').str[0].nunique()} top-level groups (used for signals).",
        "", "## Recalls", "",
        f"- Rows: {len(r):,}; distinct campaigns: {r['CAMPNO'].nunique():,} "
        "(a campaign covers several model years, one row each).",
        f"- Missing report date (RCDATE): {(r['RCDATE'] == '').sum():,}",
        f"- Filed from {START_YEAR} on (what load.py keeps): {(r['RCDATE'].str[:4] >= str(START_YEAR)).sum():,} rows, "
        f"of which vehicle recalls (RCLTYPECD = V): "
        f"{((r['RCDATE'].str[:4] >= str(START_YEAR)) & (r['RCLTYPECD'] == 'V')).sum():,}",
        "",
    ]
    out = ROOT / "reports" / "data_quality.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
