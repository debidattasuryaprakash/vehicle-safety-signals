"""Download and unzip the NHTSA complaints and recalls flat files.

Usage: python ingestion/download.py
About 200 MB zipped in all; the unzipped text files are about 1.2 GB.
"""
import sys
import urllib.request
import zipfile
from pathlib import Path

from config import RAW_DIR, SCHEMA


def fetch(name: str) -> None:
    for spec in SCHEMA[name]["files"]:
        zip_path = RAW_DIR / Path(spec["url"]).name
        print(f"Downloading {spec['url']} ...")
        urllib.request.urlretrieve(spec["url"], zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extract(spec["file"], RAW_DIR)
        zip_path.unlink()
        print(f"  extracted {spec['file']} to {RAW_DIR}")


if __name__ == "__main__":
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for dataset in sys.argv[1:] or ["complaints", "recalls"]:
        fetch(dataset)
