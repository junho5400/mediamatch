"""Hybrid Ranker — combines content-based, CF, and SVD scores.

For each candidate item, generates a feature vector:
  [content_based_score, cf_score, svd_score, media_type, has_cf_signal]

Trains a gradient boosting model to predict whether a user will rate
an item highly (>= 4.0), using the individual model scores as features.

The hybrid should outperform any individual model because:
- Content-based handles cold-start and cross-type recommendations
- CF captures community rating patterns
- SVD captures latent taste dimensions
- The hybrid learns WHEN to trust each signal

Usage:
    python -m models.hybrid --train
    python -m models.hybrid --demo
"""

import argparse
import json
import os
import pickle
import time

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score
from tqdm import tqdm

from config import settings
from embeddings.search import recommend_for_user
from models.collaborative import ItemItemCF
from models.matrix_factorization import SVDModel

MODEL_DIR = os.path.join(os.path.dirname(__file__), "saved")
RELEVANCE_THRESHOLD = 4.0


class HybridRanker:
    """Learns to combine scores from multiple recommendation models."""

    def __init__(self):
        self.model: GradientBoostingClassifier | None = None
        self.cf: ItemItemCF | None = None
        self.svd: SVDModel | None = None

    def _load_sub_models(self):
        """Load CF and SVD models."""
        if self.cf is None:
            self.cf = ItemItemCF(name="hybrid_movies")
            self.cf.load_data(
                matrix_path=os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"),
                item_mapping_path=os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"),
                user_mapping_path=os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"),
                filter_to_catalog=True,
            )
            self.cf.compute_similarity(min_ratings=5)

        if self.svd is None:
            self.svd = SVDModel("movies", n_factors=100)
            self.svd.load()

    def _get_cf_score(self, rated_items: list[dict], target_id: str) -> float:
        """Get CF score for a specific item given user's ratings."""
        rated_indices = []
        rated_ratings = []
        for item in rated_items:
            mid = item["media_id"]
            if mid in self.cf.item_mapping:
                rated_indices.append(self.cf.item_mapping[mid])
                rated_ratings.append(item["rating"])

        if not rated_indices or target_id not in self.cf.item_mapping:
            return 0.0

        target_idx = self.cf.item_mapping[target_id]
        rated_indices = np.array(rated_indices)
        rated_ratings = np.array(rated_ratings)

        sim = self.cf.item_similarity[target_idx, rated_indices]
        denom = np.abs(sim).sum()
        if denom == 0:
            return 0.0
        return float(sim @ rated_ratings / denom)

    def _get_svd_score(self, rated_items: list[dict], target_id: str) -> float:
        """Get SVD predicted score for a specific item."""
        if target_id not in self.svd.item_mapping:
            return 0.0

        user_vector = np.zeros(self.svd.n_factors)
        total_weight = 0
        for item in rated_items:
            mid = item["media_id"]
            if mid in self.svd.item_mapping:
                idx = self.svd.item_mapping[mid]
                user_vector += self.svd.item_factors[idx] * item["rating"]
                total_weight += item["rating"]

        if total_weight == 0:
            return 0.0

        user_vector /= total_weight
        norm = np.linalg.norm(user_vector)
        if norm > 0:
            user_vector /= norm

        target_idx = self.svd.item_mapping[target_id]
        return float(user_vector @ self.svd.item_factors[target_idx])

    def _get_content_score(self, rated_items: list[dict], target_id: str) -> float:
        """Get content-based score via Qdrant."""
        recs = recommend_for_user(rated_items, top_k=100)
        for r in recs:
            if r["media_id"] == target_id:
                return r["score"]
        return 0.0

    def build_training_data(self, n_users: int = 200) -> tuple[np.ndarray, np.ndarray]:
        """Build training features from MovieLens eval users.

        For each user, takes their train ratings and scores held-out test items
        using each model. The label is whether the user rated the item >= 4.0.
        """
        self._load_sub_models()

        print("Loading MovieLens data for training...")
        matrix = sparse.load_npz(os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"))
        items_df = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"))
        users_df = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"))

        idx_to_item = dict(zip(items_df["idx"], items_df["media_id"]))
        catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
        catalog_ids = set(catalog["id"].values)

        rng = np.random.RandomState(42)
        features_list = []
        labels_list = []

        # Find eligible users
        eligible = []
        for user_idx in range(matrix.shape[0]):
            row = matrix.getrow(user_idx)
            catalog_mask = [idx_to_item.get(i, "") in catalog_ids for i in row.indices]
            catalog_items = row.indices[catalog_mask]
            if len(catalog_items) >= 20:
                eligible.append((user_idx, catalog_items, row.data[catalog_mask]))
            if len(eligible) >= n_users * 3:
                break

        if len(eligible) > n_users:
            indices = rng.choice(len(eligible), size=n_users, replace=False)
            eligible = [eligible[i] for i in indices]

        print(f"Building features for {len(eligible)} users...")
        for user_idx, item_indices, ratings in tqdm(eligible, desc="Building features"):
            n = len(item_indices)
            n_train = int(n * 0.8)
            perm = rng.permutation(n)

            train_items = [
                {"media_id": idx_to_item[item_indices[perm[i]]], "rating": float(ratings[perm[i]])}
                for i in range(n_train)
            ]

            # Score each test item with all models
            for i in range(n_train, n):
                target_id = idx_to_item[item_indices[perm[i]]]
                actual_rating = float(ratings[perm[i]])
                is_relevant = 1 if actual_rating >= RELEVANCE_THRESHOLD else 0

                cf_score = self._get_cf_score(train_items, target_id)
                svd_score = self._get_svd_score(train_items, target_id)

                # Media type as feature (0=movie, 1=tv, 2=book)
                media_type_num = 0
                if target_id.startswith("tv-"):
                    media_type_num = 1
                elif target_id.startswith("book-"):
                    media_type_num = 2

                has_cf = 1 if target_id in self.cf.item_mapping else 0

                features_list.append([cf_score, svd_score, media_type_num, has_cf])
                labels_list.append(is_relevant)

        X = np.array(features_list)
        y = np.array(labels_list)
        print(f"  Features shape: {X.shape}, positive rate: {y.mean():.3f}")
        return X, y

    def train(self, n_users: int = 200):
        """Train the hybrid ranker."""
        X, y = self.build_training_data(n_users=n_users)

        print("\nTraining Gradient Boosting classifier...")
        self.model = GradientBoostingClassifier(
            n_estimators=100,
            max_depth=3,
            learning_rate=0.1,
            random_state=42,
        )

        # Cross-validate
        scores = cross_val_score(self.model, X, y, cv=3, scoring="roc_auc")
        print(f"  3-fold CV AUC: {scores.mean():.4f} ± {scores.std():.4f}")

        # Train on all data
        self.model.fit(X, y)

        # Feature importances
        feature_names = ["cf_score", "svd_score", "media_type", "has_cf"]
        importances = self.model.feature_importances_
        print("\n  Feature importances:")
        for name, imp in sorted(zip(feature_names, importances), key=lambda x: -x[1]):
            print(f"    {name}: {imp:.4f}")

    def save(self):
        os.makedirs(MODEL_DIR, exist_ok=True)
        path = os.path.join(MODEL_DIR, "hybrid_ranker.pkl")
        with open(path, "wb") as f:
            pickle.dump(self.model, f)
        print(f"  Saved to {path}")

    def load(self):
        path = os.path.join(MODEL_DIR, "hybrid_ranker.pkl")
        with open(path, "rb") as f:
            self.model = pickle.load(f)
        self._load_sub_models()
        print("  Hybrid ranker loaded")

    def recommend(self, rated_items: list[dict], top_k: int = 20,
                  media_type: str | None = None) -> list[dict]:
        """Generate hybrid recommendations.

        1. Get candidates from all three models
        2. Score each candidate with the hybrid model
        3. Rank by hybrid score
        """
        if self.model is None:
            raise ValueError("Load or train model first")

        rated_ids = {item["media_id"] for item in rated_items}

        # Gather candidates from all models
        candidates = {}

        # Content-based candidates
        cb_recs = recommend_for_user(rated_items, top_k=50, media_type=media_type)
        for r in cb_recs:
            candidates[r["media_id"]] = {
                "title": r["title"],
                "media_type": r["media_type"],
                "genres": r.get("genres", []),
                "cb_score": r["score"],
            }

        # CF candidates
        cf_recs = self.cf.recommend(rated_items, top_k=50, media_type_filter=media_type)
        for r in cf_recs:
            mid = r["media_id"]
            if mid not in candidates:
                candidates[mid] = {
                    "title": r["title"],
                    "media_type": mid.split("-")[0],
                    "genres": [],
                    "cb_score": 0.0,
                }
            candidates[mid]["cf_score"] = r["score"]

        # SVD candidates
        svd_recs = self.svd.recommend(rated_items, top_k=50, media_type_filter=media_type)
        for r in svd_recs:
            mid = r["media_id"]
            if mid not in candidates:
                candidates[mid] = {
                    "title": r["title"],
                    "media_type": mid.split("-")[0],
                    "genres": [],
                    "cb_score": 0.0,
                }
            candidates[mid]["svd_score"] = r["score"]

        # Score each candidate with hybrid model
        results = []
        for mid, info in candidates.items():
            if mid in rated_ids:
                continue

            cf_score = info.get("cf_score", self._get_cf_score(rated_items, mid))
            svd_score = info.get("svd_score", self._get_svd_score(rated_items, mid))

            media_type_num = {"movie": 0, "tv": 1, "book": 2}.get(info["media_type"], 0)
            has_cf = 1 if mid in self.cf.item_mapping else 0

            features = np.array([[cf_score, svd_score, media_type_num, has_cf]])
            # Use predict_proba for ranking (probability of being relevant)
            hybrid_score = float(self.model.predict_proba(features)[0][1])

            results.append({
                "media_id": mid,
                "title": info["title"],
                "media_type": info["media_type"],
                "genres": info["genres"],
                "score": round(hybrid_score, 4),
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]


# Module-level instance
_hybrid: HybridRanker | None = None


def get_hybrid() -> HybridRanker:
    global _hybrid
    if _hybrid is None:
        _hybrid = HybridRanker()
        _hybrid.load()
    return _hybrid


def recommend_hybrid(rated_items: list[dict], top_k: int = 20, media_type: str | None = None) -> list[dict]:
    return get_hybrid().recommend(rated_items, top_k=top_k, media_type=media_type)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", action="store_true")
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    if args.train:
        ranker = HybridRanker()
        ranker.train(n_users=200)
        ranker.save()

    if args.demo:
        ranker = HybridRanker()
        ranker.load()

        user_ratings = [
            {"media_id": "movie-550", "rating": 5.0},
            {"media_id": "movie-680", "rating": 4.5},
            {"media_id": "movie-603", "rating": 4.0},
            {"media_id": "movie-155", "rating": 5.0},
        ]

        print("\nUser rated: Fight Club (5), Pulp Fiction (4.5), The Matrix (4), Dark Knight (5)")
        recs = ranker.recommend(user_ratings, top_k=10)
        print(f"\nTop 10 Hybrid recommendations:")
        for r in recs:
            print(f"  {r['score']:.4f}  [{r['media_type']}] {r['title']}")


if __name__ == "__main__":
    main()
