"""Ranking and rating metrics for evaluating recommendation models.

Metrics:
- RMSE: Root Mean Squared Error (rating prediction quality)
- Precision@K: Fraction of top-K recommendations that are relevant
- Recall@K: Fraction of relevant items captured in top-K
- NDCG@K: Normalized Discounted Cumulative Gain (ranking quality)
- Coverage: Fraction of catalog items ever recommended
- Diversity: Average pairwise dissimilarity of recommended items
"""

import numpy as np


def rmse(predictions: list[float], actuals: list[float]) -> float:
    """Root Mean Squared Error between predicted and actual ratings."""
    preds = np.array(predictions)
    acts = np.array(actuals)
    return float(np.sqrt(np.mean((preds - acts) ** 2)))


def precision_at_k(recommended: list[str], relevant: set[str], k: int = 10) -> float:
    """Fraction of top-K recommendations that are relevant.

    relevant = items the user actually rated highly (e.g., >= 4.0) in the test set.
    """
    top_k = recommended[:k]
    if not top_k:
        return 0.0
    hits = sum(1 for item in top_k if item in relevant)
    return hits / len(top_k)


def recall_at_k(recommended: list[str], relevant: set[str], k: int = 10) -> float:
    """Fraction of relevant items captured in top-K."""
    if not relevant:
        return 0.0
    top_k = recommended[:k]
    hits = sum(1 for item in top_k if item in relevant)
    return hits / len(relevant)


def ndcg_at_k(recommended: list[str], relevant: set[str], k: int = 10) -> float:
    """Normalized Discounted Cumulative Gain at K.

    Measures ranking quality — items ranked higher get more credit.
    NDCG = DCG / IDCG, where DCG = sum(rel_i / log2(i+1)) for i in 1..K

    This is THE metric for ranking quality. Precision@K treats all positions
    equally, but NDCG rewards putting relevant items at the top.
    """
    top_k = recommended[:k]
    if not top_k or not relevant:
        return 0.0

    # DCG: sum of relevance / log2(rank + 1)
    dcg = 0.0
    for i, item in enumerate(top_k):
        if item in relevant:
            dcg += 1.0 / np.log2(i + 2)  # +2 because i is 0-indexed

    # IDCG: best possible DCG (all relevant items at the top)
    ideal_hits = min(len(relevant), k)
    idcg = sum(1.0 / np.log2(i + 2) for i in range(ideal_hits))

    if idcg == 0:
        return 0.0
    return dcg / idcg


def coverage(all_recommendations: list[list[str]], catalog_size: int) -> float:
    """Fraction of catalog items that appear in any recommendation list."""
    unique_items = set()
    for rec_list in all_recommendations:
        unique_items.update(rec_list)
    return len(unique_items) / catalog_size if catalog_size > 0 else 0.0
