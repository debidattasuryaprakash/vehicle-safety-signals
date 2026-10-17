"""Load the NHTSA flat files into the warehouse's RAW schema.

Re-runnable: each run replaces raw.complaints and raw.recalls in full.
All columns land as text (raw layer); typing and cleaning happen in dbt.

Usage:
  TARGET=duckdb    python ingestion/load.py      # local / CI
  TARGET=snowflake python ingestion/load.py      # needs SNOWFLAKE_* env vars
"""
import os
from datetime import datetime, timezone

import pandas as pd

from config import DUCKDB_PATH, RAW_DIR, SCHEMA, START_YEAR, TARGET

CHUNK = 250_000


def read_file(name: str):
    """Yield cleaned chunks of a dataset's flat files, filtered to START_YEAR onwards."""
    for f in SCHEMA[name]["files"]:
        yield from read_one(name, RAW_DIR / f["file"])


def read_one(name: str, path):
    spec = SCHEMA[name]
    cols = spec["columns"]
    with open(path, encoding="latin-1") as f:
        found = len(f.readline().rstrip("\n").split("\t"))
    if found != len(cols):
        raise SystemExit(
            f"{path.name}: found {found} columns, schema.yml lists {len(cols)}. "
            "Check NHTSA's field description file and update ingestion/schema.yml."
        )
    loaded_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for chunk in pd.read_csv(path, sep="\t", header=None, names=cols, dtype=str,
                             quoting=3, encoding="latin-1", chunksize=CHUNK,
                             on_bad_lines="warn", keep_default_na=False):
        dates = chunk[spec["date_column"]].fillna("")
        fallback = chunk["DATEA"].fillna("")
        year = dates.where(dates.str.len() == 8, fallback).str[:4]
        chunk = chunk[pd.to_numeric(year, errors="coerce") >= START_YEAR].copy()
        chunk = chunk.drop(columns=spec.get("drop_columns", []))
        chunk.columns = [c.lower() for c in chunk.columns]
        chunk["_source_file"] = path.name
        chunk["_loaded_at"] = loaded_at
        yield chunk


def load_duckdb():
    import duckdb
    DUCKDB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("create schema if not exists raw")
    for name in ("complaints", "recalls"):
        con.execute(f"drop table if exists raw.{name}")
        total = 0
        for i, chunk in enumerate(read_file(name)):
            con.register("chunk_df", chunk)
            con.execute(f"create table raw.{name} as select * from chunk_df" if i == 0
                        else f"insert into raw.{name} select * from chunk_df")
            con.unregister("chunk_df")
            total += len(chunk)
        print(f"raw.{name}: {total:,} rows -> {DUCKDB_PATH.name}")
    con.close()


def load_snowflake():
    import snowflake.connector
    from snowflake.connector.pandas_tools import write_pandas
    con = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"], role=os.getenv("SNOWFLAKE_ROLE"),
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"], database=os.environ["SNOWFLAKE_DATABASE"],
    )
    con.cursor().execute("create schema if not exists RAW")
    for name in ("complaints", "recalls"):
        con.cursor().execute(f"drop table if exists RAW.{name.upper()}")
        total = 0
        for chunk in read_file(name):
            chunk.columns = [c.upper() for c in chunk.columns]
            write_pandas(con, chunk, name.upper(), schema="RAW", auto_create_table=True)
            total += len(chunk)
        print(f"RAW.{name.upper()}: {total:,} rows -> Snowflake")
    con.close()


if __name__ == "__main__":
    load_snowflake() if TARGET == "snowflake" else load_duckdb()
