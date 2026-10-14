"""Read Danbooru cooccurrences without loading the full dataset into memory."""

from pathlib import Path
import sqlite3


INDEX_PATH = Path(__file__).resolve().parents[1] / "data" / "danbooru_related.sqlite3"


def query_related_tags(tag, index_path=INDEX_PATH):
    tag = tag.strip().lower().replace(" ", "_")
    if not index_path.is_file():
        raise FileNotFoundError(index_path)
    connection = sqlite3.connect(index_path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        rows = connection.execute("""
            SELECT tags.name, pairs.count FROM pairs
            JOIN tags ON tags.id = pairs.b
            WHERE pairs.a = (SELECT id FROM tags WHERE name = ?)
            UNION ALL
            SELECT tags.name, pairs.count FROM pairs
            JOIN tags ON tags.id = pairs.a
            WHERE pairs.b = (SELECT id FROM tags WHERE name = ?)
        """, (tag, tag)).fetchall()
        return [{"name": name, "cooccurrence": count} for name, count in rows]
    finally:
        connection.close()
