"""Download and process MovieLens 25M dataset for collaborative filtering.

MovieLens 25M contains ~25 million ratings from ~162,000 users across ~62,000 movies.
Each movie has a TMDB ID mapping, letting us connect ratings to our media catalog.

Downloads from: https://files.grouplens.org/datasets/movielens/ml-25m.zip

Usage:
    python -m data.ingest_movielens
"""

import os
import zipfile

import numpy as np
import pandas as pd
import requests
from scipy import sparse
from tqdm import tqdm

from config import settings

MOVIELENS_URL = "https://files.grouplens.org/datasets/movielens/ml-25m.zip"
ZIP_PATH = os.path.join(settings.DATA_DIR, "ml-25m.zip")
EXTRACT_DIR = os.path.join(settings.DATA_DIR, "ml-25m")


def download_movielens():
    """Download MovieLens 25M if not already present."""
    if os.path.exists(EXTRACT_DIR):
        print("MovieLens 25M already extracted, skipping download.")
        return

    os.makedirs(settings.DATA_DIR, exist_ok=True)

    if not os.path.exists(ZIP_PATH):
        print("Downloading MovieLens 25M (~250MB)...")
        resp = requests.get(MOVIELENS_URL, stream=True, timeout=30)
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        with open(ZIP_PATH, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc="Download") as pbar:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                pbar.update(len(chunk))

    print("Extracting...")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        zf.extractall(settings.DATA_DIR)
    print("Done.")


def load_and_process():
    """Load MovieLens data, map to TMDB IDs, build rating matrix."""
    processed_dir = settings.PROCESSED_DIR
    os.makedirs(processed_dir, exist_ok=True)

    # --- Load links (movieId -> tmdbId mapping) ---
    links = pd.read_csv(os.path.join(EXTRACT_DIR, "links.csv"))
    links = links.dropna(subset=["tmdbId"])
    links["tmdbId"] = links["tmdbId"].astype(int)
    movie_to_tmdb = dict(zip(links["movieId"], links["tmdbId"]))
    print(f"Loaded {len(movie_to_tmdb)} movie->TMDB mappings")

    # --- Load ratings ---
    print("Loading ratings (this takes a moment)...")
    ratings = pd.read_csv(os.path.join(EXTRACT_DIR, "ratings.csv"))
    print(f"Raw ratings: {len(ratings):,}")

    # Map movieId to TMDB ID and create our media ID format
    ratings["tmdbId"] = ratings["movieId"].map(movie_to_tmdb)
    ratings = ratings.dropna(subset=["tmdbId"])
    ratings["tmdbId"] = ratings["tmdbId"].astype(int)
    ratings["media_id"] = "movie-" + ratings["tmdbId"].astype(str)
    print(f"Ratings with TMDB mapping: {len(ratings):,}")

    # --- Load our catalog to see overlap ---
    catalog_path = os.path.join(processed_dir, "media_catalog.parquet")
    if os.path.exists(catalog_path):
        catalog = pd.read_parquet(catalog_path)
        catalog_ids = set(catalog["id"].values)
        in_catalog = ratings["media_id"].isin(catalog_ids)
        print(f"Ratings for items in our catalog: {in_catalog.sum():,} ({in_catalog.mean():.1%})")
    else:
        print("Warning: No catalog found. Run merge_catalog.py first for overlap stats.")

    # --- Build user-item matrix ---
    # Create compact integer indices for users and items
    user_ids = ratings["userId"].unique()
    media_ids = ratings["media_id"].unique()

    user_to_idx = {uid: idx for idx, uid in enumerate(user_ids)}
    item_to_idx = {mid: idx for idx, mid in enumerate(media_ids)}

    # Reverse mappings for lookup
    idx_to_user = {idx: uid for uid, idx in user_to_idx.items()}
    idx_to_item = {idx: mid for mid, idx in item_to_idx.items()}

    row = ratings["userId"].map(user_to_idx).values
    col = ratings["media_id"].map(item_to_idx).values
    data = ratings["rating"].values

    matrix = sparse.csr_matrix(
        (data, (row, col)),
        shape=(len(user_ids), len(media_ids)),
    )
    print(f"\nRating matrix: {matrix.shape[0]:,} users x {matrix.shape[1]:,} items")
    print(f"Sparsity: {1 - matrix.nnz / (matrix.shape[0] * matrix.shape[1]):.4%}")

    # --- EDA ---
    print("\n--- Rating Distribution ---")
    rating_counts = pd.Series(data).value_counts().sort_index()
    for rating, count in rating_counts.items():
        print(f"  {rating:.1f}: {count:>10,} ({count/len(data):.1%})")

    ratings_per_user = np.diff(matrix.indptr)
    ratings_per_item = np.array(matrix.getnnz(axis=0)).flatten()

    print(f"\n--- Ratings per User ---")
    print(f"  Mean: {ratings_per_user.mean():.1f}")
    print(f"  Median: {np.median(ratings_per_user):.0f}")
    print(f"  Min: {ratings_per_user.min()}, Max: {ratings_per_user.max()}")

    print(f"\n--- Ratings per Item ---")
    print(f"  Mean: {ratings_per_item.mean():.1f}")
    print(f"  Median: {np.median(ratings_per_item):.0f}")
    print(f"  Min: {ratings_per_item.min()}, Max: {ratings_per_item.max()}")

    # --- Save ---
    sparse.save_npz(os.path.join(processed_dir, "rating_matrix.npz"), matrix)

    # Save mappings
    mapping_df = pd.DataFrame({
        "idx": range(len(media_ids)),
        "media_id": media_ids,
    })
    mapping_df.to_parquet(os.path.join(processed_dir, "item_mapping.parquet"), index=False)

    user_mapping_df = pd.DataFrame({
        "idx": range(len(user_ids)),
        "user_id": user_ids,
    })
    user_mapping_df.to_parquet(os.path.join(processed_dir, "user_mapping.parquet"), index=False)

    print(f"\nSaved to {processed_dir}:")
    print(f"  rating_matrix.npz ({matrix.nnz:,} nonzeros)")
    print(f"  item_mapping.parquet ({len(media_ids):,} items)")
    print(f"  user_mapping.parquet ({len(user_ids):,} users)")


def main():
    download_movielens()
    load_and_process()


if __name__ == "__main__":
    main()
