#!/usr/bin/env python3
"""Validate the immutable DBN corpus and build resumable daily Parquet partitions."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import databento as db
import pandas as pd

ROOT = Path("data/databento-v2")
RAW = ROOT / "raw/opra-pillar/cbbo-1m"
DERIVED = ROOT / "derived/parquet"
DOWNLOAD_RECEIPT = ROOT / "manifests/download-2022-01-03_2026-07-10-w10-dte2.json"
VALIDATION_RECEIPT = ROOT / "manifests/validation.json"
CONVERSION_RECEIPT = ROOT / "manifests/parquet-conversion.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def files() -> list[Path]:
    return sorted(RAW.glob("*/*.dbn.zst"))


def decode(path: Path) -> tuple[Any, pd.DataFrame]:
    store = db.DBNStore.from_file(path)
    frame = store.to_df().reset_index()
    return store.metadata, frame


def sample_paths(all_files: list[Path]) -> list[Path]:
    by_year: dict[str, list[Path]] = {}
    for path in all_files:
        by_year.setdefault(path.parent.name, []).append(path)
    selected: list[Path] = []
    for year_paths in by_year.values():
        selected.extend([year_paths[0], year_paths[len(year_paths) // 2], year_paths[-1]])
    return list(dict.fromkeys(selected))


def validate() -> None:
    receipt = json.loads(DOWNLOAD_RECEIPT.read_text())
    expected = {item["path"]: item for item in receipt["files"]}
    all_files = files()
    if len(all_files) != 1133 or len(expected) != 1133:
        raise RuntimeError(f"corpus incomplete: disk={len(all_files)} receipt={len(expected)}")
    checked: list[dict[str, Any]] = []
    for index, path in enumerate(all_files, 1):
        item = expected.get(str(path))
        actual_hash = sha256(path)
        if not item or item["bytes"] != path.stat().st_size or item["sha256"] != actual_hash:
            raise RuntimeError(f"receipt mismatch: {path}")
        checked.append({"path": str(path), "bytes": path.stat().st_size, "sha256": actual_hash})
        if index % 200 == 0:
            print(f"checksum {index}/{len(all_files)}")

    decoded: list[dict[str, Any]] = []
    for path in sample_paths(all_files):
        metadata, frame = decode(path)
        if frame.empty:
            raise RuntimeError(f"empty decoded sample: {path}")
        if "symbol" not in frame or "bid_px_00" not in frame or "ask_px_00" not in frame:
            raise RuntimeError(f"unexpected schema: {path}")
        symbols = frame["symbol"].dropna().astype(str)
        roots = sorted(set(symbols.str.slice(0, 6).str.strip()))
        if not set(roots).issubset({"SPY", "QQQ", "IWM"}):
            raise RuntimeError(f"unexpected roots {roots}: {path}")
        valid = frame.dropna(subset=["bid_px_00", "ask_px_00"])
        crossed = int((valid["ask_px_00"] < valid["bid_px_00"]).sum())
        negative = int(((valid["ask_px_00"] < 0) | (valid["bid_px_00"] < 0)).sum())
        decoded.append({
            "path": str(path), "rows": len(frame), "symbols": int(symbols.nunique()),
            "roots": roots, "crossedQuotes": crossed, "negativeQuotes": negative,
            "firstTs": str(frame["ts_recv"].min()), "lastTs": str(frame["ts_recv"].max()),
            "dataset": str(metadata.dataset), "schema": str(metadata.schema),
        })
        print(f"decode {path.stem[:10]} · {len(frame):,} rows · {symbols.nunique():,} symbols")

    result = {
        "validatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "totals": {"files": len(checked), "bytes": sum(item["bytes"] for item in checked)},
        "decodedSamples": decoded,
        "files": checked,
    }
    VALIDATION_RECEIPT.write_text(json.dumps(result, separators=(",", ":")))
    print(f"validation green · {len(checked)} checksums · {len(decoded)} decoded samples")


def normalize(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame[[
        "ts_recv", "publisher_id", "instrument_id", "symbol", "bid_px_00", "ask_px_00",
        "bid_sz_00", "ask_sz_00", "flags",
    ]].copy()
    symbols = out["symbol"].fillna("").astype(str)
    out["underlying"] = symbols.str.slice(0, 6).str.strip()
    out["expiration"] = pd.to_datetime(symbols.str.slice(6, 12), format="%y%m%d", errors="coerce").dt.date
    out["opt_type"] = symbols.str.slice(12, 13).map({"C": "call", "P": "put"})
    out["strike"] = pd.to_numeric(symbols.str.slice(13, 21), errors="coerce") / 1000.0
    out = out.rename(columns={
        "bid_px_00": "bid", "ask_px_00": "ask", "bid_sz_00": "bid_size", "ask_sz_00": "ask_size",
    })
    return out[[
        "ts_recv", "symbol", "underlying", "expiration", "strike", "opt_type",
        "bid", "ask", "bid_size", "ask_size", "publisher_id", "instrument_id", "flags",
    ]]


def convert() -> None:
    if not VALIDATION_RECEIPT.exists():
        raise RuntimeError("run --validate before conversion")
    validation = json.loads(VALIDATION_RECEIPT.read_text())
    if validation.get("totals", {}).get("files") != 1133:
        raise RuntimeError("validation receipt is not green")
    all_files = files()
    converted: list[dict[str, Any]] = []
    for index, source in enumerate(all_files, 1):
        target_dir = DERIVED / source.parent.name
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / source.name.replace(".cbbo-1m.dbn.zst", ".parquet")
        if not target.exists():
            _, frame = decode(source)
            normalized = normalize(frame)
            temp = target.with_suffix(".parquet.partial")
            normalized.to_parquet(temp, engine="pyarrow", compression="zstd", index=False)
            os.replace(temp, target)
        converted.append({
            "source": str(source), "path": str(target), "bytes": target.stat().st_size,
            "sha256": sha256(target),
        })
        if index % 25 == 0 or index == len(all_files):
            CONVERSION_RECEIPT.write_text(json.dumps({
                "updatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
                "files": converted,
                "totals": {"files": len(converted), "bytes": sum(item["bytes"] for item in converted)},
            }, separators=(",", ":")))
            print(f"parquet {index}/{len(all_files)}")
    print(f"conversion green · {len(converted)} daily Parquet partitions")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--convert", action="store_true")
    args = parser.parse_args()
    if args.validate == args.convert:
        parser.error("choose exactly one of --validate or --convert")
    validate() if args.validate else convert()
