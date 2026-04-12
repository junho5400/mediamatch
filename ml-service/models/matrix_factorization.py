"""Matrix Factorization using Truncated SVD (scikit-learn).

Decomposes the user-item rating matrix into latent factors:
  R ≈ U × Σ × V^T

Each user gets a latent vector (from U × Σ), each item gets a latent vector (from V^T).
The predicted rating for a (user, item) pair is the dot product of their vectors
plus the global mean and item/user bias.

Usage:
    python -m models.matrix_factorization --train
    python -m models.matrix_factorization --demo
"""

import argparse
import os
import pickle
import time

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.model_selection import KFold

from config import settings

MODEL_DIR = os.path.join(os.path.dirname(__file__), "saved")


class SVDModel:
    """SVD-based recommendation model.

    Stores item latent factors and bias terms. At prediction time,
    projects a new user into the latent space and predicts ratings.
    """

    def __init__(self, name: str, n_factors: int = 100):
        self.name = name
        self.n_factors = n_factors
        self.item_factors: np.ndarray | None = None  # (n_items, n_factors)
        self.global_mean: float = 0.0
        self.item_bias: np.ndarray | None = None  # (n_items,)
        self.item_mapping: dict[str, int] = {}
        self.idx_to_item: dict[int, str] = {}
        self.catalog_ids: set[str] = set()
        self.catalog_titles: dict[str, str] = {}

    def train(self, matrix_path: str, item_mapping_path: str, user_mapping_path: str):
        """Train SVD on the rating matrix."""
        print(f"[{self.name}] Loading data...")
        matrix = sparse.load_npz(matrix_path).astype(np.float32)
        items = pd.read_parquet(item_mapping_path)
        self.item_mapping = dict(zip(items["media_id"], items["idx"]))
        self.idx_to_item = dict(zip(items["idx"], items["media_id"]))

        print(f"  {matrix.shape[0]:,} users x {matrix.shape[1]:,} items, {matrix.nnz:,} ratings")

        # Compute biases
        self.global_mean = matrix.data.mean()
        # Item bias: mean rating per item minus global mean
        item_sums = np.array(matrix.sum(axis=0)).flatten()
        item_counts = np.array(matrix.getnnz(axis=0)).flatten()
        item_counts[item_counts == 0] = 1
        item_means = item_sums / item_counts
        self.item_bias = item_means - self.global_mean

        # Center the matrix (subtract global mean from nonzero entries)
        centered = matrix.copy()
        centered.data -= self.global_mean

        # Cross-validate to report RMSE
        print(f"\n[{self.name}] Cross-validating (3-fold)...")
        self._cross_validate(matrix, n_folds=3)

        # Train on full data
        print(f"\n[{self.name}] Training SVD with {self.n_factors} factors...")
        start = time.time()
        svd = TruncatedSVD(n_components=self.n_factors, random_state=42)
        svd.fit(centered)

        # Item factors: V^T transposed = (n_items, n_factors)
        self.item_factors = svd.components_.T
        # Normalize for cosine-like predictions
        norms = np.linalg.norm(self.item_factors, axis=1, keepdims=True)
        norms[norms == 0] = 1
        self.item_factors = self.item_factors / norms

        elapsed = time.time() - start
        print(f"  Trained in {elapsed:.1f}s")
        print(f"  Explained variance ratio: {svd.explained_variance_ratio_.sum():.4f}")

    def _cross_validate(self, matrix: sparse.csr_matrix, n_folds: int = 3):
        """Simple cross-validation: hold out ratings and measure RMSE."""
        coo = matrix.tocoo()
        indices = np.arange(coo.nnz)
        rng = np.random.RandomState(42)
        rng.shuffle(indices)

        fold_size = len(indices) // n_folds
        rmses = []

        for fold in range(n_folds):
            test_idx = indices[fold * fold_size:(fold + 1) * fold_size]
            train_idx = np.concatenate([indices[:fold * fold_size], indices[(fold + 1) * fold_size:]])

            # Build train matrix
            train_matrix = sparse.csr_matrix(
                (coo.data[train_idx], (coo.row[train_idx], coo.col[train_idx])),
                shape=matrix.shape,
            )

            # Train SVD on fold
            mean = train_matrix.data.mean()
            centered = train_matrix.copy()
            centered.data -= mean

            svd = TruncatedSVD(n_components=self.n_factors, random_state=42)
            user_factors = svd.fit_transform(centered)
            item_factors = svd.components_.T

            # Predict test ratings
            test_rows = coo.row[test_idx]
            test_cols = coo.col[test_idx]
            test_actual = coo.data[test_idx]

            preds = np.array([
                user_factors[r] @ item_factors[c] + mean
                for r, c in zip(test_rows, test_cols)
            ])
            preds = np.clip(preds, 0.5, 5.0)

            rmse = np.sqrt(np.mean((preds - test_actual) ** 2))
            rmses.append(rmse)
            print(f"  Fold {fold + 1}: RMSE = {rmse:.4f}")

        print(f"  Mean RMSE: {np.mean(rmses):.4f} ± {np.std(rmses):.4f}")

    def save(self):
        """Save trained model to disk."""
        os.makedirs(MODEL_DIR, exist_ok=True)
        path = os.path.join(MODEL_DIR, f"svd_{self.name}.pkl")
        with open(path, "wb") as f:
            pickle.dump({
                "item_factors": self.item_factors,
                "global_mean": self.global_mean,
                "item_bias": self.item_bias,
                "item_mapping": self.item_mapping,
                "idx_to_item": self.idx_to_item,
            }, f)
        print(f"  Saved to {path}")

    def load(self):
        """Load trained model from disk."""
        path = os.path.join(MODEL_DIR, f"svd_{self.name}.pkl")
        if not os.path.exists(path):
            raise FileNotFoundError(f"No model at {path}. Run --train first.")

        with open(path, "rb") as f:
            data = pickle.load(f)

        self.item_factors = data["item_factors"]
        self.global_mean = data["global_mean"]
        self.item_bias = data["item_bias"]
        self.item_mapping = data["item_mapping"]
        self.idx_to_item = data["idx_to_item"]

        # Load catalog
        catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
        self.catalog_ids = set(catalog["id"].values)
        self.catalog_titles = dict(zip(catalog["id"], catalog["title"]))

        print(f"  [{self.name}] SVD loaded: {len(self.item_mapping):,} items, {self.item_factors.shape[1]} factors")

    def recommend(self, rated_items: list[dict], top_k: int = 20,
                  media_type_filter: str | None = None) -> list[dict]:
        """Generate recommendations for a new user.

        Projects the user into the item factor space by computing their
        preference vector as the weighted average of their rated items' factors.
        Then scores all items by dot product with this preference vector.
        """
        if self.item_factors is None:
            raise ValueError("Load model first")

        rated_ids = set()
        user_vector = np.zeros(self.n_factors)
        total_weight = 0

        for item in rated_items:
            mid = item["media_id"]
            rated_ids.add(mid)
            if mid in self.item_mapping:
                idx = self.item_mapping[mid]
                weight = item["rating"]
                user_vector += self.item_factors[idx] * weight
                total_weight += weight

        if total_weight == 0:
            return []

        user_vector /= total_weight
        # Normalize
        norm = np.linalg.norm(user_vector)
        if norm > 0:
            user_vector /= norm

        # Score all items: dot product + bias
        scores = self.item_factors @ user_vector + self.item_bias * 0.1  # Small bias contribution

        # Rank and filter
        ranked = np.argsort(scores)[::-1]
        results = []
        for idx in ranked:
            if len(results) >= top_k:
                break
            media_id = self.idx_to_item.get(idx)
            if media_id is None or media_id in rated_ids or media_id not in self.catalog_ids:
                continue
            if media_type_filter:
                if media_id.split("-")[0] != media_type_filter:
                    continue
            score = float(scores[idx])
            results.append({
                "media_id": media_id,
                "title": self.catalog_titles.get(media_id, ""),
                "score": round(score, 4),
            })

        return results


# --- Module-level instances ---
_movie_svd: SVDModel | None = None
_book_svd: SVDModel | None = None


def get_movie_svd() -> SVDModel:
    global _movie_svd
    if _movie_svd is None:
        _movie_svd = SVDModel("movies", n_factors=100)
        _movie_svd.load()
    return _movie_svd


def get_book_svd() -> SVDModel:
    global _book_svd
    if _book_svd is None:
        _book_svd = SVDModel("books", n_factors=50)
        _book_svd.load()
    return _book_svd


def recommend_svd(rated_items: list[dict], top_k: int = 20, media_type: str | None = None) -> list[dict]:
    """Get SVD recommendations from both models."""
    all_results = []

    if media_type is None or media_type == "movie":
        try:
            all_results.extend(get_movie_svd().recommend(rated_items, top_k=top_k, media_type_filter="movie"))
        except FileNotFoundError:
            pass

    if media_type is None or media_type == "book":
        try:
            all_results.extend(get_book_svd().recommend(rated_items, top_k=top_k, media_type_filter="book"))
        except FileNotFoundError:
            pass

    all_results.sort(key=lambda x: x["score"], reverse=True)
    return all_results[:top_k]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true")
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    if args.train:
        print("=== Training Movie SVD ===")
        model = SVDModel("movies", n_factors=100)
        model.train(
            matrix_path=os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"),
            item_mapping_path=os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"),
            user_mapping_path=os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"),
        )
        model.save()

        print("\n=== Training Book SVD ===")
        model = SVDModel("books", n_factors=50)
        model.train(
            matrix_path=os.path.join(settings.PROCESSED_DIR, "book_rating_matrix.npz"),
            item_mapping_path=os.path.join(settings.PROCESSED_DIR, "book_item_mapping.parquet"),
            user_mapping_path=os.path.join(settings.PROCESSED_DIR, "book_user_mapping.parquet"),
        )
        model.save()

    if args.demo:
        print("=== SVD Demo ===")
        model = get_movie_svd()

        user_ratings = [
            {"media_id": "movie-550", "rating": 5.0},    # Fight Club
            {"media_id": "movie-680", "rating": 4.5},     # Pulp Fiction
            {"media_id": "movie-603", "rating": 4.0},     # The Matrix
            {"media_id": "movie-155", "rating": 5.0},     # The Dark Knight
        ]

        print("\nUser rated: Fight Club (5), Pulp Fiction (4.5), The Matrix (4), Dark Knight (5)")
        recs = model.recommend(user_ratings, top_k=10)
        print(f"\nTop 10 SVD recommendations:")
        for r in recs:
            print(f"  {r['score']:.4f}  {r['title']}")


if __name__ == "__main__":
    main()
