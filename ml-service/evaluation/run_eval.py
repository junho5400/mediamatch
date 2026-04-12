"""Offline evaluation pipeline — compares all recommendation models.

Methodology:
1. For each test user, hold out 20% of their ratings as the "test set"
2. Use the remaining 80% as the user's "profile" (what the model sees)
3. Generate recommendations from each model
4. Measure how well each model recovers the held-out items

We only evaluate on users with enough ratings (>= 20) and only consider
items in our catalog (not MovieLens-only items).

Usage:
    python -m evaluation.run_eval
"""

import json
import os
import time

import numpy as np
import pandas as pd
from scipy import sparse
from tqdm import tqdm

from config import settings
from evaluation.metrics import precision_at_k, recall_at_k, ndcg_at_k, coverage
from models.collaborative import ItemItemCF
from models.matrix_factorization import SVDModel
from models.hybrid import HybridRanker

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
K = 10  # Evaluate @K
RELEVANCE_THRESHOLD = 4.0  # Ratings >= this are "relevant"
MIN_USER_RATINGS = 20  # Only evaluate users with enough data
MAX_EVAL_USERS = 200  # Cap for speed (CF is O(n_items) per user)
TRAIN_RATIO = 0.8


def prepare_eval_data():
    """Split MovieLens data into train/test per user."""
    print("Loading MovieLens data...")
    matrix = sparse.load_npz(os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"))
    items = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"))
    users = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"))

    idx_to_item = dict(zip(items["idx"], items["media_id"]))
    idx_to_user = dict(zip(users["idx"], users["user_id"].astype(str)))

    # Load catalog for filtering
    catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
    catalog_ids = set(catalog["id"].values)

    # Find users with enough ratings for items in our catalog
    print("Selecting evaluation users...")
    rng = np.random.RandomState(42)
    eval_users = []

    for user_idx in range(matrix.shape[0]):
        row = matrix.getrow(user_idx)
        item_indices = row.indices
        ratings = row.data

        # Filter to catalog items
        catalog_mask = [idx_to_item.get(i, "") in catalog_ids for i in item_indices]
        catalog_items = item_indices[catalog_mask]
        catalog_ratings = ratings[catalog_mask]

        if len(catalog_items) >= MIN_USER_RATINGS:
            eval_users.append((user_idx, catalog_items, catalog_ratings))

        if len(eval_users) >= MAX_EVAL_USERS * 3:  # Collect extra, then sample
            break

    # Sample
    if len(eval_users) > MAX_EVAL_USERS:
        indices = rng.choice(len(eval_users), size=MAX_EVAL_USERS, replace=False)
        eval_users = [eval_users[i] for i in indices]

    print(f"  {len(eval_users)} evaluation users selected")

    # Split each user's ratings into train/test
    splits = []
    for user_idx, item_indices, ratings in eval_users:
        n = len(item_indices)
        n_train = int(n * TRAIN_RATIO)

        perm = rng.permutation(n)
        train_idx = perm[:n_train]
        test_idx = perm[n_train:]

        train_items = [
            {"media_id": idx_to_item[item_indices[i]], "rating": float(ratings[i])}
            for i in train_idx
        ]
        test_items = {
            idx_to_item[item_indices[i]]: float(ratings[i])
            for i in test_idx
        }

        splits.append({
            "user_id": idx_to_user.get(user_idx, str(user_idx)),
            "train": train_items,
            "test": test_items,
        })

    return splits


def evaluate_content_based(splits: list[dict]) -> dict:
    """Evaluate content-based recommendations."""
    from embeddings.search import recommend_for_user

    print("\n=== Evaluating Content-Based ===")
    precisions, recalls, ndcgs = [], [], []
    all_recs = []

    for split in tqdm(splits, desc="Content-Based"):
        # Relevant = test items rated >= threshold
        relevant = {mid for mid, r in split["test"].items() if r >= RELEVANCE_THRESHOLD}
        if not relevant:
            continue

        recs = recommend_for_user(split["train"], top_k=K)
        rec_ids = [r["media_id"] for r in recs]
        all_recs.append(rec_ids)

        precisions.append(precision_at_k(rec_ids, relevant, K))
        recalls.append(recall_at_k(rec_ids, relevant, K))
        ndcgs.append(ndcg_at_k(rec_ids, relevant, K))

    return {
        f"precision@{K}": np.mean(precisions),
        f"recall@{K}": np.mean(recalls),
        f"ndcg@{K}": np.mean(ndcgs),
        "coverage": coverage(all_recs, 10637),
        "n_users": len(precisions),
    }


def evaluate_cf(splits: list[dict]) -> dict:
    """Evaluate item-item collaborative filtering."""
    print("\n=== Evaluating Item-Item CF ===")

    # Load CF model (filtered to catalog items for speed)
    cf = ItemItemCF(name="eval_movies")
    cf.load_data(
        matrix_path=os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"),
        item_mapping_path=os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"),
        user_mapping_path=os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"),
        filter_to_catalog=True,
    )
    cf.compute_similarity(min_ratings=5)

    precisions, recalls, ndcgs = [], [], []
    all_recs = []

    for split in tqdm(splits, desc="Item-Item CF"):
        relevant = {mid for mid, r in split["test"].items() if r >= RELEVANCE_THRESHOLD}
        if not relevant:
            continue

        recs = cf.recommend(split["train"], top_k=K)
        rec_ids = [r["media_id"] for r in recs]
        all_recs.append(rec_ids)

        precisions.append(precision_at_k(rec_ids, relevant, K))
        recalls.append(recall_at_k(rec_ids, relevant, K))
        ndcgs.append(ndcg_at_k(rec_ids, relevant, K))

    return {
        f"precision@{K}": np.mean(precisions),
        f"recall@{K}": np.mean(recalls),
        f"ndcg@{K}": np.mean(ndcgs),
        "coverage": coverage(all_recs, 10637),
        "n_users": len(precisions),
    }


def evaluate_svd(splits: list[dict]) -> dict:
    """Evaluate SVD matrix factorization."""
    print("\n=== Evaluating SVD ===")

    svd = SVDModel("movies", n_factors=100)
    svd.load()

    precisions, recalls, ndcgs = [], [], []
    all_recs = []

    for split in tqdm(splits, desc="SVD"):
        relevant = {mid for mid, r in split["test"].items() if r >= RELEVANCE_THRESHOLD}
        if not relevant:
            continue

        recs = svd.recommend(split["train"], top_k=K)
        rec_ids = [r["media_id"] for r in recs]
        all_recs.append(rec_ids)

        precisions.append(precision_at_k(rec_ids, relevant, K))
        recalls.append(recall_at_k(rec_ids, relevant, K))
        ndcgs.append(ndcg_at_k(rec_ids, relevant, K))

    return {
        f"precision@{K}": np.mean(precisions),
        f"recall@{K}": np.mean(recalls),
        f"ndcg@{K}": np.mean(ndcgs),
        "coverage": coverage(all_recs, 10637),
        "n_users": len(precisions),
    }


def evaluate_hybrid(splits: list[dict]) -> dict:
    """Evaluate hybrid ranker."""
    print("\n=== Evaluating Hybrid ===")

    ranker = HybridRanker()
    ranker.load()

    precisions, recalls, ndcgs = [], [], []
    all_recs = []

    for split in tqdm(splits, desc="Hybrid"):
        relevant = {mid for mid, r in split["test"].items() if r >= RELEVANCE_THRESHOLD}
        if not relevant:
            continue

        recs = ranker.recommend(split["train"], top_k=K)
        rec_ids = [r["media_id"] for r in recs]
        all_recs.append(rec_ids)

        precisions.append(precision_at_k(rec_ids, relevant, K))
        recalls.append(recall_at_k(rec_ids, relevant, K))
        ndcgs.append(ndcg_at_k(rec_ids, relevant, K))

    return {
        f"precision@{K}": np.mean(precisions),
        f"recall@{K}": np.mean(recalls),
        f"ndcg@{K}": np.mean(ndcgs),
        "coverage": coverage(all_recs, 10637),
        "n_users": len(precisions),
    }


def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)

    # Prepare eval data
    splits = prepare_eval_data()

    # Evaluate each model
    results = {}

    results["content_based"] = evaluate_content_based(splits)
    results["item_item_cf"] = evaluate_cf(splits)
    results["svd"] = evaluate_svd(splits)
    results["hybrid"] = evaluate_hybrid(splits)

    # Print comparison table
    print("\n" + "=" * 70)
    print(f"{'MODEL':<20} {'P@10':<10} {'R@10':<10} {'NDCG@10':<10} {'Coverage':<10}")
    print("=" * 70)
    for name, metrics in results.items():
        print(f"{name:<20} {metrics[f'precision@{K}']:<10.4f} {metrics[f'recall@{K}']:<10.4f} "
              f"{metrics[f'ndcg@{K}']:<10.4f} {metrics['coverage']:<10.4f}")
    print("=" * 70)

    # Save results
    output_path = os.path.join(RESULTS_DIR, "model_comparison.json")
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to {output_path}")


if __name__ == "__main__":
    main()
