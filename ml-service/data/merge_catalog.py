"""Merge TMDB and Google Books data into a single unified catalog.

Reads the raw JSON files from the ingestion scripts, deduplicates,
and saves as a single Parquet file for efficient loading in the ML pipeline.

Usage:
    python -m data.merge_catalog
"""

import json
import os

import pandas as pd

from config import settings


def main():
    raw_dir = settings.DATA_DIR
    processed_dir = settings.PROCESSED_DIR
    os.makedirs(processed_dir, exist_ok=True)

    all_items = []

    # Load TMDB
    tmdb_path = os.path.join(raw_dir, "tmdb_media.json")
    if os.path.exists(tmdb_path):
        with open(tmdb_path) as f:
            tmdb_data = json.load(f)
        all_items.extend(tmdb_data)
        print(f"Loaded {len(tmdb_data)} items from TMDB")

    # Load Books
    books_path = os.path.join(raw_dir, "books_media.json")
    if os.path.exists(books_path):
        with open(books_path) as f:
            books_data = json.load(f)
        all_items.extend(books_data)
        print(f"Loaded {len(books_data)} items from Google Books")

    if not all_items:
        print("No data found. Run ingest_tmdb.py and ingest_books.py first.")
        return

    # Convert to DataFrame
    df = pd.DataFrame(all_items)

    # Deduplicate by id
    before = len(df)
    df = df.drop_duplicates(subset=["id"], keep="first")
    print(f"Deduped: {before} -> {len(df)}")

    # Basic stats
    print(f"\n--- Catalog Stats ---")
    print(f"Total items: {len(df)}")
    print(f"By type:")
    print(df["media_type"].value_counts().to_string())
    print(f"\nDescription length (chars):")
    print(df["description"].str.len().describe().to_string())
    print(f"\nItems with ratings > 0: {(df['rating'] > 0).sum()}")

    # Save as Parquet (compact, fast to load, preserves types)
    output_path = os.path.join(processed_dir, "media_catalog.parquet")
    df.to_parquet(output_path, index=False)
    print(f"\nSaved catalog to {output_path}")

    # Also save a small sample for quick inspection
    sample_path = os.path.join(processed_dir, "catalog_sample.json")
    sample = df.head(5).to_dict(orient="records")
    with open(sample_path, "w") as f:
        json.dump(sample, f, indent=2)
    print(f"Saved sample to {sample_path}")


if __name__ == "__main__":
    main()
