"""Build the local Danbooru related-tag index from tag_a,tag_b,count CSV data."""

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import time


def build_index(source, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=output.name + "-", suffix=".tmp", dir=output.parent)
    os.close(fd)
    started = time.perf_counter()
    names = {}
    rows = 0
    skipped = 0
    connection = sqlite3.connect(temporary)
    try:
        connection.executescript("""
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
            CREATE TABLE pairs (
                a INTEGER NOT NULL, b INTEGER NOT NULL, count INTEGER NOT NULL,
                PRIMARY KEY (a, b)
            ) WITHOUT ROWID;
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        pending = []
        with source.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not {"tag_a", "tag_b", "count"}.issubset(reader.fieldnames or []):
                raise ValueError("Expected CSV columns: tag_a,tag_b,count")
            for row in reader:
                tag_a = row["tag_a"].strip().lower().replace(" ", "_")
                tag_b = row["tag_b"].strip().lower().replace(" ", "_")
                try:
                    number = float(row["count"])
                    count = int(number) if math.isfinite(number) else 0
                except ValueError:
                    count = 0
                if not tag_a or not tag_b or tag_a == tag_b or count <= 0:
                    skipped += 1
                    continue
                for name in (tag_a, tag_b):
                    if name not in names:
                        names[name] = len(names) + 1
                a, b = sorted((names[tag_a], names[tag_b]))
                pending.append((a, b, count))
                rows += 1
                if len(pending) >= 20000:
                    # The original loader keeps the last count for a duplicate pair.
                    connection.executemany("INSERT OR REPLACE INTO pairs VALUES (?, ?, ?)", pending)
                    pending.clear()
        connection.executemany("INSERT OR REPLACE INTO pairs VALUES (?, ?, ?)", pending)
        connection.executemany("INSERT INTO tags VALUES (?, ?)", ((value, name) for name, value in names.items()))
        connection.execute("CREATE INDEX pairs_by_b ON pairs (b, a, count)")
        with source.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        report = {
            "source": source.name,
            "source_sha256": digest,
            "source_rows": rows,
            "skipped_rows": skipped,
            "tags": len(names),
            "pairs": connection.execute("SELECT count(*) FROM pairs").fetchone()[0],
            "schema_version": 1,
        }
        connection.executemany("INSERT INTO metadata VALUES (?, ?)", ((key, str(value)) for key, value in report.items()))
        connection.commit()
        connection.close()
        os.replace(temporary, output)
    finally:
        connection.close()
        if os.path.exists(temporary):
            os.remove(temporary)
    report.update(output=str(output), bytes=output.stat().st_size, seconds=round(time.perf_counter() - started, 2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Danbooru cooccurrence CSV")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "danbooru_related.sqlite3")
    arguments = parser.parse_args()
    print(json.dumps(build_index(arguments.source, arguments.output), ensure_ascii=False, indent=2))
