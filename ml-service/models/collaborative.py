"""Item-Item Collaborative Filtering.

Uses cosine similarity on the rating matrix to find items that are rated
similarly by the same users. For a given user, scores unrated items by
their weighted similarity to the user's rated items.

Works with both MovieLens (movies) and Goodreads (books) rating matrices.

Usage:
    python -m models.collaborative --demo
"""

import argparse
import os
import time

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.metrics.pairwise import cosine_similarity

from config import settings

# Load catalog IDs for filtering recommendations to items we have metadata for
_catalog_ids: set[str] | None = None
_catalog_titles: dict[str, str] = {}


def _get_catalog():
    global _catalog_ids, _catalog_titles
    if _catalog_ids is None:
        catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
        _catalog_ids = set(catalog["id"].values)
        _catalog_titles = dict(zip(catalog["id"], catalog["title"]))
    return _catalog_ids, _catalog_titles


class ItemItemCF:
    """Item-Item Collaborative Filtering model.

    Precomputes item-item similarity matrix from a user-item rating matrix.
    At recommendation time, scores each candidate item by its weighted
    similarity to the user's rated items.
    """

    def __init__(self, name: str = "default"):
        self.name = name
        self.rating_matrix: sparse.csr_matrix | None = None
        self.item_similarity: np.ndarray | None = None
        self.item_mapping: dict[str, int] = {}  # media_id -> matrix column index
        self.idx_to_item: dict[int, str] = {}   # matrix column index -> media_id
        self.user_mapping: dict[str, int] = {}   # user_id -> matrix row index

    def load_data(self, matrix_path: str, item_mapping_path: str, user_mapping_path: str,
                  filter_to_catalog: bool = True):
        """Load rating matrix and mappings from processed data files.

        If filter_to_catalog is True, drops columns (items) that aren't in our
        catalog. This is critical for performance: MovieLens has 59K items but
        our catalog only has ~4K movies, so filtering reduces the similarity
        matrix from 59K×59K to ~4K×4K (200x speedup).
        """
        full_matrix = sparse.load_npz(matrix_path)
        items = pd.read_parquet(item_mapping_path)
        users = pd.read_parquet(user_mapping_path)

        if filter_to_catalog:
            catalog_ids, _ = _get_catalog()
            # Find which columns (items) are in our catalog
            keep_mask = items["media_id"].isin(catalog_ids).values
            keep_indices = np.where(keep_mask)[0]

            # Slice the matrix to only catalog columns
            self.rating_matrix = full_matrix[:, keep_indices].tocsr()

            # Rebuild mappings with new indices
            kept_items = items[keep_mask].reset_index(drop=True)
            self.item_mapping = dict(zip(kept_items["media_id"], range(len(kept_items))))
            self.idx_to_item = dict(zip(range(len(kept_items)), kept_items["media_id"]))

            print(f"  [{self.name}] Loaded & filtered: {self.rating_matrix.shape[0]:,} users x {self.rating_matrix.shape[1]:,} items (from {full_matrix.shape[1]:,})")
        else:
            self.rating_matrix = full_matrix
            self.item_mapping = dict(zip(items["media_id"], items["idx"]))
            self.idx_to_item = dict(zip(items["idx"], items["media_id"]))
            print(f"  [{self.name}] Loaded: {self.rating_matrix.shape[0]:,} users x {self.rating_matrix.shape[1]:,} items")

        self.user_mapping = dict(zip(users["user_id"].astype(str), users["idx"]))

    def compute_similarity(self, min_ratings: int = 5):
        """Compute item-item cosine similarity.

        Only considers items with at least `min_ratings` to avoid noise
        from items rated by very few users.

        This is the expensive step — O(items^2) comparisons. For 59K items,
        we compute similarity in blocks to manage memory.
        """
        if self.rating_matrix is None:
            raise ValueError("Load data first")

        print(f"  [{self.name}] Computing item-item similarity...")
        start = time.time()

        # Transpose: we want item-item similarity, so items become rows
        item_user_matrix = self.rating_matrix.T.tocsr()

        # Filter items with too few ratings
        ratings_per_item = np.array(item_user_matrix.getnnz(axis=1)).flatten()
        valid_mask = ratings_per_item >= min_ratings
        n_valid = valid_mask.sum()
        print(f"  [{self.name}] {n_valid:,} items with >= {min_ratings} ratings (of {item_user_matrix.shape[0]:,} total)")

        # Compute cosine similarity (sklearn handles sparse matrices efficiently)
        # For large matrices, this returns a dense matrix — can be memory-heavy
        # We only compute for valid items
        valid_indices = np.where(valid_mask)[0]
        valid_matrix = item_user_matrix[valid_indices]

        similarity = cosine_similarity(valid_matrix)

        # Zero out self-similarity (diagonal)
        np.fill_diagonal(similarity, 0)

        # Store full-size similarity matrix with zeros for filtered items
        self.item_similarity = np.zeros((item_user_matrix.shape[0], item_user_matrix.shape[0]))
        self.item_similarity[np.ix_(valid_indices, valid_indices)] = similarity

        elapsed = time.time() - start
        print(f"  [{self.name}] Similarity computed in {elapsed:.1f}s")

    def recommend(
        self,
        rated_items: list[dict],
        top_k: int = 20,
        media_type_filter: str | None = None,
    ) -> list[dict]:
        """Generate recommendations for a user based on their rated items.

        For each unrated item, compute:
            score = sum(similarity[item][rated_item] * rating) / sum(|similarity|)

        Args:
            rated_items: List of {"media_id": str, "rating": float}
            top_k: Number of recommendations
            media_type_filter: Optional filter (e.g., "movie", "book")
        """
        if self.item_similarity is None:
            raise ValueError("Compute similarity first")

        # Map rated items to matrix indices
        rated_indices = []
        rated_ratings = []
        rated_ids = set()
        for item in rated_items:
            mid = item["media_id"]
            rated_ids.add(mid)
            if mid in self.item_mapping:
                rated_indices.append(self.item_mapping[mid])
                rated_ratings.append(item["rating"])

        if not rated_indices:
            return []

        rated_indices = np.array(rated_indices)
        rated_ratings = np.array(rated_ratings)

        # Score all items: weighted sum of similarities to rated items
        # sim_to_rated shape: (n_items, n_rated)
        sim_to_rated = self.item_similarity[:, rated_indices]

        # Weighted score: sum(sim * rating) / sum(|sim|)
        numerator = sim_to_rated @ rated_ratings
        denominator = np.abs(sim_to_rated).sum(axis=1)
        denominator[denominator == 0] = 1  # Avoid division by zero

        scores = numerator / denominator

        # Vectorized filtering: build a mask for valid candidates
        catalog_ids, catalog_titles = _get_catalog()
        n_items = len(scores)

        # Pre-build valid mask (only needs to happen once per model, but cheap enough)
        valid_mask = np.ones(n_items, dtype=bool)
        rated_idx_set = set(rated_indices)
        for idx in range(n_items):
            media_id = self.idx_to_item.get(idx)
            if media_id is None or media_id not in catalog_ids:
                valid_mask[idx] = False
            elif idx in rated_idx_set:
                valid_mask[idx] = False
            elif media_type_filter and media_id.split("-")[0] != media_type_filter:
                valid_mask[idx] = False

        # Zero out invalid items, then take top_k
        scores[~valid_mask] = -1
        top_indices = np.argsort(scores)[::-1][:top_k]

        results = []
        for idx in top_indices:
            score = float(scores[idx])
            if score <= 0:
                break
            media_id = self.idx_to_item[idx]
            results.append({
                "media_id": media_id,
                "title": catalog_titles.get(media_id, ""),
                "score": round(score, 4),
            })

        return results


# --- Module-level instances ---

_movie_cf: ItemItemCF | None = None
_book_cf: ItemItemCF | None = None


def get_movie_cf() -> ItemItemCF:
    """Get or initialize the movie CF model."""
    global _movie_cf
    if _movie_cf is None:
        _movie_cf = ItemItemCF(name="movies")
        _movie_cf.load_data(
            matrix_path=os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"),
            item_mapping_path=os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"),
            user_mapping_path=os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"),
            filter_to_catalog=True,
        )
        _movie_cf.compute_similarity(min_ratings=5)
    return _movie_cf


def get_book_cf() -> ItemItemCF:
    """Get or initialize the book CF model."""
    global _book_cf
    if _book_cf is None:
        _book_cf = ItemItemCF(name="books")
        _book_cf.load_data(
            matrix_path=os.path.join(settings.PROCESSED_DIR, "book_rating_matrix.npz"),
            item_mapping_path=os.path.join(settings.PROCESSED_DIR, "book_item_mapping.parquet"),
            user_mapping_path=os.path.join(settings.PROCESSED_DIR, "book_user_mapping.parquet"),
            filter_to_catalog=True,
        )
        _book_cf.compute_similarity(min_ratings=3)
    return _book_cf


def recommend_cf(
    rated_items: list[dict], top_k: int = 20, media_type: str | None = None
) -> list[dict]:
    """Get CF recommendations, using both movie and book models.

    Combines results from both models and sorts by score.
    """
    all_results = []

    # Movie CF
    if media_type is None or media_type == "movie":
        movie_model = get_movie_cf()
        movie_recs = movie_model.recommend(rated_items, top_k=top_k, media_type_filter="movie")
        all_results.extend(movie_recs)

    # Book CF
    if media_type is None or media_type == "book":
        book_model = get_book_cf()
        book_recs = book_model.recommend(rated_items, top_k=top_k, media_type_filter="book")
        all_results.extend(book_recs)

    # Sort by score and take top_k
    all_results.sort(key=lambda x: x["score"], reverse=True)
    return all_results[:top_k]


def demo():
    """Run a demo to verify CF is working."""
    # Simulate a user who likes some well-known movies
    print("=== Movie CF Demo ===")
    movie_model = get_movie_cf()

    user_ratings = [
        {"media_id": "movie-550", "rating": 5.0},    # Fight Club
        {"media_id": "movie-680", "rating": 4.5},     # Pulp Fiction
        {"media_id": "movie-603", "rating": 4.0},     # The Matrix
        {"media_id": "movie-155", "rating": 5.0},     # The Dark Knight
    ]

    print("\nUser rated: Fight Club (5), Pulp Fiction (4.5), The Matrix (4), Dark Knight (5)")
    recs = movie_model.recommend(user_ratings, top_k=10)
    print(f"\nTop 10 CF recommendations:")
    for r in recs:
        print(f"  {r['score']:.3f}  {r['media_id']}")

    print("\n=== Book CF Demo ===")
    book_model = get_book_cf()
    print(f"  Book model has {len(book_model.item_mapping)} items")

    # Use first few book IDs from the mapping
    sample_books = list(book_model.item_mapping.keys())[:3]
    book_ratings = [{"media_id": mid, "rating": 4.0} for mid in sample_books]
    print(f"\nUser rated: {[r['media_id'] for r in book_ratings]}")
    recs = book_model.recommend(book_ratings, top_k=5)
    print(f"\nTop 5 book CF recommendations:")
    for r in recs:
        print(f"  {r['score']:.3f}  {r['media_id']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    if args.demo:
        demo()
