"""Pull reviews for catalog items from TMDB API and Goodreads dataset.

Saves a JSON mapping: media_id -> list of review snippets.
These get appended to embedding text for richer catalog embeddings.

Usage:
    python -m data.ingest_reviews
"""

import gzip
import json
import os
import re
import time

import pandas as pd
import requests
from tqdm import tqdm

from config import settings

TMDB_API = "https://api.themoviedb.org/3"
GOODREADS_REVIEWS_FILE = "goodreads_reviews_spoiler.json.gz"
GOODREADS_URL = f"https://mcauleylab.ucsd.edu/public_datasets/gdrive/goodreads/{GOODREADS_REVIEWS_FILE}"
RAW_DIR = os.path.join(settings.DATA_DIR, "goodreads")

MIN_REVIEW_LENGTH = 150  # Skip short junk reviews
MAX_REVIEWS_PER_ITEM = 5  # Keep top N reviews
MAX_SNIPPET_LENGTH = 200  # Truncate individual reviews


def extract_best_sentence(review_text: str) -> str:
    """Extract the most descriptive sentence from a review.

    Picks the longest sentence that contains adjectives/descriptive words,
    skipping generic opener sentences like "I loved this movie."
    """
    # Split into sentences
    sentences = re.split(r'[.!?]+', review_text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 30]

    if not sentences:
        return review_text[:MAX_SNIPPET_LENGTH]

    # Score sentences by length and presence of descriptive words
    # Longer sentences with more content words tend to be more descriptive
    scored = []
    skip_patterns = re.compile(
        r'^(i (loved?|hated?|liked?|enjoyed?|watched|read|saw|think|would|couldn|didn)|'
        r'this (is|was) (a )?(great|good|bad|terrible|amazing|awesome|ok|decent)|'
        r'(one of|definitely|absolutely|highly|strongly|totally)|'
        r'\d+/\d+|stars?)',
        re.IGNORECASE
    )
    for sent in sentences:
        if skip_patterns.match(sent):
            continue
        scored.append((len(sent), sent))

    if not scored:
        # Fallback: just use the longest sentence
        scored = [(len(s), s) for s in sentences]

    scored.sort(reverse=True)
    return scored[0][1][:MAX_SNIPPET_LENGTH]


def fetch_tmdb_reviews() -> dict[str, list[str]]:
    """Fetch reviews for all movies and TV shows in our catalog from TMDB API."""
    catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
    tmdb_items = catalog[catalog["source"] == "tmdb"]

    reviews_map: dict[str, list[str]] = {}
    no_reviews = 0

    print(f"Fetching TMDB reviews for {len(tmdb_items)} items...")
    for _, row in tqdm(tmdb_items.iterrows(), total=len(tmdb_items), desc="TMDB reviews"):
        media_id = row["id"]
        external_id = row["external_id"]
        media_type = row["media_type"]

        endpoint = f"{TMDB_API}/{media_type}/{external_id}/reviews"
        try:
            resp = requests.get(
                endpoint,
                params={"api_key": settings.TMDB_API_KEY},
                timeout=10,
            )
            if resp.status_code == 429:
                time.sleep(2)
                resp = requests.get(
                    endpoint,
                    params={"api_key": settings.TMDB_API_KEY},
                    timeout=10,
                )
            if resp.status_code != 200:
                continue

            data = resp.json()
            results = data.get("results", [])

            # Filter and extract best snippets
            snippets = []
            for review in results:
                content = review.get("content", "")
                if len(content) < MIN_REVIEW_LENGTH:
                    continue
                snippet = extract_best_sentence(content)
                if snippet:
                    snippets.append(snippet)

            if snippets:
                reviews_map[media_id] = snippets[:MAX_REVIEWS_PER_ITEM]
            else:
                no_reviews += 1

        except Exception:
            continue

        time.sleep(0.03)  # Stay under rate limit

    print(f"  Got reviews for {len(reviews_map)} items ({no_reviews} had no quality reviews)")
    return reviews_map


def fetch_goodreads_reviews(gr_to_catalog_path: str) -> dict[str, list[str]]:
    """Extract reviews for our catalog books from Goodreads dataset."""
    # Load our Goodreads -> catalog mapping
    if not os.path.exists(gr_to_catalog_path):
        print("  No Goodreads mapping found. Skipping book reviews.")
        return {}

    with open(gr_to_catalog_path) as f:
        gr_to_catalog = json.load(f)

    gr_book_ids = set(gr_to_catalog.keys())
    print(f"  Looking for reviews matching {len(gr_book_ids)} Goodreads book IDs...")

    # Download reviews file if needed
    reviews_path = os.path.join(RAW_DIR, GOODREADS_REVIEWS_FILE)
    if not os.path.exists(reviews_path):
        print(f"  Downloading {GOODREADS_REVIEWS_FILE} (~591MB)...")
        resp = requests.get(GOODREADS_URL, stream=True, timeout=30)
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        with open(reviews_path, "wb") as f, tqdm(total=total, unit="B", unit_scale=True) as pbar:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                pbar.update(len(chunk))

    # Collect reviews per catalog book
    reviews_by_catalog_id: dict[str, list[str]] = {}

    print("  Scanning Goodreads reviews...")
    with gzip.open(reviews_path, "rt", encoding="utf-8") as f:
        for line in tqdm(f, desc="Goodreads reviews", unit=" reviews"):
            try:
                review = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            book_id = review.get("book_id", "")
            if book_id not in gr_book_ids:
                continue

            # review_sentences is a list of [spoiler_flag, sentence_text] pairs
            sentences = review.get("review_sentences", [])
            # Join non-spoiler sentences into full text
            text = " ".join(sent for flag, sent in sentences if flag == 0)
            text = text.strip()
            rating = review.get("rating", 0)
            if len(text) < MIN_REVIEW_LENGTH or rating == 0:
                continue

            catalog_id = gr_to_catalog[book_id]
            if catalog_id not in reviews_by_catalog_id:
                reviews_by_catalog_id[catalog_id] = []

            # Only keep up to MAX_REVIEWS_PER_ITEM
            if len(reviews_by_catalog_id[catalog_id]) < MAX_REVIEWS_PER_ITEM:
                snippet = extract_best_sentence(text)
                if snippet:
                    reviews_by_catalog_id[catalog_id].append(snippet)

    print(f"  Got reviews for {len(reviews_by_catalog_id)} catalog books")
    return reviews_by_catalog_id


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    output_path = os.path.join(settings.PROCESSED_DIR, "media_reviews.json")

    all_reviews: dict[str, list[str]] = {}

    # --- TMDB reviews ---
    print("=== TMDB Reviews ===")
    tmdb_reviews = fetch_tmdb_reviews()
    all_reviews.update(tmdb_reviews)

    # --- Goodreads reviews ---
    print("\n=== Goodreads Reviews ===")
    gr_mapping_path = os.path.join(RAW_DIR, "gr_to_catalog_map.json")
    gr_reviews = fetch_goodreads_reviews(gr_mapping_path)
    all_reviews.update(gr_reviews)

    # --- Save ---
    with open(output_path, "w") as f:
        json.dump(all_reviews, f, indent=2)

    # Stats
    total_items = len(all_reviews)
    total_snippets = sum(len(v) for v in all_reviews.values())
    avg_snippets = total_snippets / total_items if total_items > 0 else 0

    print(f"\n=== Summary ===")
    print(f"Items with reviews: {total_items:,}")
    print(f"Total review snippets: {total_snippets:,}")
    print(f"Avg snippets per item: {avg_snippets:.1f}")
    print(f"Saved to {output_path}")


if __name__ == "__main__":
    main()
