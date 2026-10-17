"""Shared settings: paths, schema, and which warehouse to load into."""
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = Path(os.getenv("RAW_DIR", ROOT / "data" / "raw"))
DUCKDB_PATH = Path(os.getenv("DUCKDB_PATH", ROOT / "data" / "warehouse.duckdb"))
TARGET = os.getenv("TARGET", "duckdb")          # "duckdb" (local/CI) or "snowflake"
START_YEAR = int(os.getenv("START_YEAR", "2020"))  # first year loaded

with open(ROOT / "ingestion" / "schema.yml") as f:
    SCHEMA = yaml.safe_load(f)
