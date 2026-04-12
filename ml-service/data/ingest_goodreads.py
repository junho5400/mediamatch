"""Download and process Goodreads (UCSD Book Graph) dataset for book collaborative filtering.

Strategy (title-based matching — no Google Books API calls needed):
1. Download Goodreads book metadata (has titles, ISBNs, ratings)
2. Download interaction CSV (user ratings)
3. Match Goodreads books to our catalog by normalized title
4. Build book rating matrix from matched interactions

Data source: https://sites.google.com/eng.ucsd.edu/ucsdbookgraph/home/
Citation: Mengting Wan, Julian McAuley, "Item Recommendation on Monotonic Behavior Chains", RecSys 2018.

Usage:
    python -m data.ingest_goodreads
"""

import gzip
import json
import os
import re

import numpy as np
import pandas as pd
import requests
from scipy import sparse
from tqdm import tqdm

from config import settings

BASE_URL = "https://mcauleylab.ucsd.edu/public_datasets/gdrive/goodreads"

BOOKS_META_FILE = "goodreads_books.json.gz"
INTERACTIONS_FILE = "goodreads_interactions.csv"

RAW_DIR = os.path.join(settings.DATA_DIR, "goodreads")


def download_file(filename: str, desc: str = ""):
    """Download a file from UCSD if not already present."""
    filepath = os.path.join(RAW_DIR, filename)
    if os.path.exists(filepath):
        print(f"  Already exists: {filename}")
        return filepath

    url = f"{BASE_URL}/{filename}"
    print(f"  Downloading {desc or filename}...")
    resp = requests.get(url, stream=True, timeout=30)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))
    with open(filepath, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc=filename[:40]) as pbar:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
            pbar.update(len(chunk))
    return filepath


def normalize_title(title: str) -> str:
    """Normalize a title for fuzzy matching."""
    title = title.lower().strip()
    # Remove subtitle after colon
    title = title.split(":")[0].strip()
    # Remove series info in parens like "(Book 1)" or "(#1)"
    title = re.sub(r"\s*\(.*?\)\s*", " ", title)
    # Remove punctuation
    title = re.sub(r"[^\w\s]", "", title)
    # Collapse whitespace
    title = re.sub(r"\s+", " ", title).strip()
    return title


def build_title_mapping() -> dict[str, str]:
    """Build mapping from normalized title -> our catalog book ID.

    Returns dict like {"harry potter and the philosophers stone": "book-2_zzAAAACAAJ"}
    """
    catalog_path = os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet")
    catalog = pd.read_parquet(catalog_path)
    books = catalog[catalog["media_type"] == "book"]

    title_map = {}
    for _, row in books.iterrows():
        norm = normalize_title(row["title"])
        if norm and norm not in title_map:  # First match wins (avoids duplicates)
            title_map[norm] = row["id"]

    print(f"  Built title map: {len(title_map)} unique normalized titles from catalog")
    return title_map


def build_goodreads_to_catalog(books_meta_path: str, catalog_title_map: dict[str, str]) -> dict[str, str]:
    """Map Goodreads book_ids to our catalog IDs via title matching.

    Reads the 2.3M book metadata file, normalizes each title, and checks
    if it matches any title in our catalog.

    Returns: dict mapping goodreads_book_id -> our_catalog_id
    """
    print("  Matching Goodreads books to catalog by title...")
    gr_to_catalog = {}
    total = 0
    no_title = 0

    with gzip.open(books_meta_path, "rt", encoding="utf-8") as f:
        for line in tqdm(f, desc="Scanning Goodreads metadata", unit=" books"):
            total += 1
            try:
                book = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            gr_id = book.get("book_id", "")
            title = book.get("title", "").strip()
            if not title:
                no_title += 1
                continue

            norm = normalize_title(title)
            if norm in catalog_title_map:
                gr_to_catalog[gr_id] = catalog_title_map[norm]

    print(f"  Scanned {total:,} Goodreads books ({no_title:,} without title)")
    print(f"  Matched {len(gr_to_catalog):,} Goodreads books to {len(set(gr_to_catalog.values())):,} catalog items")
    return gr_to_catalog


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(settings.PROCESSED_DIR, exist_ok=True)

    # --- Step 1: Build catalog title map ---
    print("=== Step 1: Build Catalog Title Map ===")
    catalog_title_map = build_title_mapping()

    # --- Step 2: Download Goodreads book metadata ---
    print("\n=== Step 2: Download Goodreads Book Metadata ===")
    books_meta_path = download_file(BOOKS_META_FILE, "book metadata (~1.9GB)")

    # --- Step 3: Match Goodreads -> catalog by title ---
    print("\n=== Step 3: Title Matching ===")
    gr_to_catalog = build_goodreads_to_catalog(books_meta_path, catalog_title_map)

    if not gr_to_catalog:
        print("No matches found. Cannot build rating matrix.")
        return

    # Save mapping for debugging/reuse
    mapping_path = os.path.join(RAW_DIR, "gr_to_catalog_map.json")
    with open(mapping_path, "w") as f:
        json.dump(gr_to_catalog, f)
    print(f"  Saved mapping to {mapping_path}")

    # --- Step 4: Download and process interactions ---
    print("\n=== Step 4: Download & Process Interactions ===")
    interactions_path = download_file(INTERACTIONS_FILE, "interactions CSV (~4GB)")

    print("  Processing interactions (streaming)...")
    all_ratings = []
    chunk_size = 500_000
    total_scanned = 0

    for chunk in pd.read_csv(interactions_path, chunksize=chunk_size):
        total_scanned += len(chunk)
        # Filter: must have rating > 0 and book_id must map to our catalog
        chunk["book_id_str"] = chunk["book_id"].astype(str)
        rated = chunk[chunk["rating"] > 0]
        matched = rated[rated["book_id_str"].isin(gr_to_catalog)]

        for _, row in matched.iterrows():
            all_ratings.append({
                "user_id": str(row["user_id"]),
                "media_id": gr_to_catalog[str(row["book_id"])],
                "rating": float(row["rating"]),
            })

        if total_scanned % 5_000_000 == 0:
            print(f"    Scanned {total_scanned:,} rows, matched {len(all_ratings):,} so far")

    print(f"  Scanned {total_scanned:,} total rows, matched {len(all_ratings):,} ratings")

    if not all_ratings:
        print("No matching ratings found.")
        return

    ratings_df = pd.DataFrame(all_ratings)
    ratings_df = ratings_df.drop_duplicates(subset=["user_id", "media_id"], keep="first")

    print(f"\n  Deduplicated ratings: {len(ratings_df):,}")
    print(f"  Unique users: {ratings_df['user_id'].nunique():,}")
    print(f"  Unique books: {ratings_df['media_id'].nunique():,}")

    # --- Step 5: Build rating matrix ---
    print("\n=== Step 5: Build Rating Matrix ===")
    user_ids = ratings_df["user_id"].unique()
    media_ids = ratings_df["media_id"].unique()

    user_to_idx = {uid: idx for idx, uid in enumerate(user_ids)}
    item_to_idx = {mid: idx for idx, mid in enumerate(media_ids)}

    row = ratings_df["user_id"].map(user_to_idx).values
    col = ratings_df["media_id"].map(item_to_idx).values
    data = ratings_df["rating"].values.astype(np.float32)

    matrix = sparse.csr_matrix(
        (data, (row, col)),
        shape=(len(user_ids), len(media_ids)),
    )

    print(f"  Rating matrix: {matrix.shape[0]:,} users x {matrix.shape[1]:,} items")
    print(f"  Sparsity: {1 - matrix.nnz / (matrix.shape[0] * matrix.shape[1]):.4%}")

    # --- EDA ---
    print("\n--- Rating Distribution ---")
    rating_counts = pd.Series(data).value_counts().sort_index()
    for rating_val, count in rating_counts.items():
        print(f"  {rating_val:.0f}: {count:>10,} ({count / len(data):.1%})")

    ratings_per_user = np.diff(matrix.indptr)
    print(f"\n--- Ratings per User ---")
    print(f"  Mean: {ratings_per_user.mean():.1f}, Median: {np.median(ratings_per_user):.0f}")

    # --- Save ---
    sparse.save_npz(os.path.join(settings.PROCESSED_DIR, "book_rating_matrix.npz"), matrix)

    item_mapping = pd.DataFrame({"idx": range(len(media_ids)), "media_id": media_ids})
    item_mapping.to_parquet(os.path.join(settings.PROCESSED_DIR, "book_item_mapping.parquet"), index=False)

    user_mapping = pd.DataFrame({"idx": range(len(user_ids)), "user_id": user_ids})
    user_mapping.to_parquet(os.path.join(settings.PROCESSED_DIR, "book_user_mapping.parquet"), index=False)

    print(f"\nSaved to {settings.PROCESSED_DIR}:")
    print(f"  book_rating_matrix.npz ({matrix.nnz:,} nonzeros)")
    print(f"  book_item_mapping.parquet ({len(media_ids):,} items)")
    print(f"  book_user_mapping.parquet ({len(user_ids):,} users)")


if __name__ == "__main__":
    main()
