"""Smart Recommendation Router.

Instead of a fixed hybrid model, this router selects and weights
recommendation strategies based on:
1. What data is available for the candidate item (CF signal? SVD signal? embeddings?)
2. How much data the user has (new user vs. active user)
3. Media type (movies have CF/SVD, TV shows only have content-based)

Also handles on-the-fly embedding for new items not in the catalog.

Usage:
    python -m models.router --demo
"""

import argparse
import os
import threading

import numpy as np
import pandas as pd
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from sentence_transformers import SentenceTransformer

from config import settings
from embeddings.search import recommend_for_user, search_by_text, _query_qdrant, get_user_taste_vector
from models.collaborative import ItemItemCF
from models.matrix_factorization import SVDModel


class RecommendationRouter:
    """Routes recommendations through the best available models.

    Scoring formula per candidate item:
        final_score = w_cb * content_score + w_svd * svd_score + w_cf * cf_score

    Weights are determined dynamically based on what signal exists:
    - Item in SVD model? → SVD gets high weight
    - Item has CF signal? → CF gets some weight
    - Always includes content-based as baseline
    - Weights normalized to sum to 1.0
    """

    # Base weights (before normalization) — tuned based on eval results
    W_CONTENT = 0.3     # Always available
    W_SVD = 1.0         # Strong when available (best single model)
    W_CF = 0.2          # Weak due to popularity bias, but adds diversity

    def __init__(self):
        self.cf: ItemItemCF | None = None
        self.svd: SVDModel | None = None
        self.qdrant: QdrantClient | None = None
        self.model: SentenceTransformer | None = None
        self.catalog_titles: dict[str, str] = {}
        self.catalog_types: dict[str, str] = {}

    def load(self):
        """Load all sub-models."""
        print("Loading recommendation router...")

        # CF
        self.cf = ItemItemCF(name="router_movies")
        self.cf.load_data(
            matrix_path=os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"),
            item_mapping_path=os.path.join(settings.PROCESSED_DIR, "item_mapping.parquet"),
            user_mapping_path=os.path.join(settings.PROCESSED_DIR, "user_mapping.parquet"),
            filter_to_catalog=True,
        )
        self.cf.compute_similarity(min_ratings=5)

        # SVD
        self.svd = SVDModel("movies", n_factors=100)
        self.svd.load()

        # Qdrant
        self.qdrant = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)

        # Catalog metadata
        catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
        self.catalog_titles = dict(zip(catalog["id"], catalog["title"]))
        self.catalog_types = dict(zip(catalog["id"], catalog["media_type"]))

        print("  Router ready.")

    def _get_cf_scores(self, rated_items: list[dict]) -> dict[str, float]:
        """Get CF scores for all catalog items."""
        recs = self.cf.recommend(rated_items, top_k=200)
        return {r["media_id"]: r["score"] for r in recs}

    def _get_svd_scores(self, rated_items: list[dict]) -> dict[str, float]:
        """Get SVD scores for all catalog items."""
        recs = self.svd.recommend(rated_items, top_k=200)
        return {r["media_id"]: r["score"] for r in recs}

    def _get_content_scores(self, rated_items: list[dict]) -> dict[str, float]:
        """Get content-based scores."""
        recs = recommend_for_user(rated_items, top_k=200)
        return {r["media_id"]: r["score"] for r in recs}

    def recommend_for_you(self, rated_items: list[dict], top_k: int = 20,
                          media_type: str | None = None) -> list[dict]:
        """Personalized "For You" recommendations — SVD + content-based.

        Uses SVD for items with rating history, content-based for everything
        else (cold-start, TV, books, cross-type). CF is excluded here because
        its popularity bias works against personalization.

        For new users with no ratings, falls back to popular recommendations.
        """
        if not rated_items:
            return self._popular_cold_start(top_k, media_type, set())

        rated_ids = {item["media_id"] for item in rated_items}

        cb_scores = self._get_content_scores(rated_items)
        svd_scores = self._get_svd_scores(rated_items)

        all_candidates = set(cb_scores.keys()) | set(svd_scores.keys())

        results = []
        for mid in all_candidates:
            if mid in rated_ids:
                continue
            if media_type and self.catalog_types.get(mid, mid.split("-")[0]) != media_type:
                continue

            cb = cb_scores.get(mid, 0.0)
            svd = svd_scores.get(mid, 0.0)

            # Dynamic weighting: SVD when available, content-based always
            w_cb = self.W_CONTENT
            w_svd = self.W_SVD if mid in self.svd.item_mapping and svd != 0 else 0.0

            total_w = w_cb + w_svd
            if total_w == 0:
                continue
            w_cb /= total_w
            w_svd /= total_w

            svd_normalized = (svd + 1) / 2 if svd != 0 else 0
            final_score = w_cb * cb + w_svd * svd_normalized

            item_type = self.catalog_types.get(mid, mid.split("-")[0])
            results.append({
                "media_id": mid,
                "title": self.catalog_titles.get(mid, ""),
                "media_type": item_type,
                "genres": [],
                "score": round(final_score, 4),
                "_signals": {
                    "content": round(cb, 4),
                    "svd": round(svd, 4),
                    "weights": {"cb": round(w_cb, 2), "svd": round(w_svd, 2)},
                },
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def _load_catalog_quality(self):
        """Load rating and review count data for quality filtering."""
        if not hasattr(self, "_catalog_ratings") or self._catalog_ratings is None:
            catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
            self._catalog_ratings = dict(zip(catalog["id"], catalog["rating"]))
            self._catalog_total_ratings = dict(zip(catalog["id"], catalog["total_ratings"]))

            # Also load review counts
            reviews_path = os.path.join(settings.PROCESSED_DIR, "media_reviews.json")
            self._catalog_review_counts = {}
            if os.path.exists(reviews_path):
                import json
                with open(reviews_path) as f:
                    reviews = json.load(f)
                self._catalog_review_counts = {mid: len(snippets) for mid, snippets in reviews.items()}

    def recommend_popular(self, rated_items: list[dict], top_k: int = 20,
                          media_type: str | None = None) -> list[dict]:
        """\"People Love\" recommendations — CF signal filtered by quality.

        For users with ratings: combines CF taste signal with quality gates.
        For new users (no ratings): returns top-rated, most-reviewed items
        from the catalog — a pure quality-based "what's popular" list.
        """
        self._load_catalog_quality()
        rated_ids = {item["media_id"] for item in rated_items}

        # Cold start: no ratings → pure quality ranking
        if not rated_items:
            return self._popular_cold_start(top_k, media_type, rated_ids)

        cf_scores = self._get_cf_scores(rated_items)

        if not cf_scores:
            return self._popular_cold_start(top_k, media_type, rated_ids)

        # Quality thresholds by media type
        MIN_RATING = {"movie": 7.0, "tv": 7.0, "book": 3.5}
        MIN_TOTAL_RATINGS = {"movie": 100, "tv": 50, "book": 10}

        results = []
        for mid, cf_score in cf_scores.items():
            if mid in rated_ids or cf_score <= 0:
                continue

            item_type = self.catalog_types.get(mid, mid.split("-")[0])
            if media_type and item_type != media_type:
                continue

            # Quality gates
            rating = self._catalog_ratings.get(mid, 0)
            total_ratings = self._catalog_total_ratings.get(mid, 0)
            min_r = MIN_RATING.get(item_type, 7.0)
            min_n = MIN_TOTAL_RATINGS.get(item_type, 100)

            if rating < min_r or total_ratings < min_n:
                continue

            # Score: mostly quality, slight CF personalization
            # 80% quality (rating + popularity) + 20% CF taste signal
            cf_norm = min(cf_score / 5.0, 1.0)
            rating_norm = rating / 10.0 if item_type != "book" else rating / 5.0
            popularity_norm = min(total_ratings / 10000, 1.0)
            review_boost = 1.1 if mid in self._catalog_review_counts else 1.0

            quality_score = rating_norm * 0.7 + popularity_norm * 0.3
            final_score = quality_score * 0.8 + cf_norm * 0.2
            final_score *= review_boost

            results.append({
                "media_id": mid,
                "title": self.catalog_titles.get(mid, ""),
                "media_type": item_type,
                "genres": [],
                "score": round(final_score, 4),
                "_quality": {
                    "cf_score": round(cf_score, 2),
                    "rating": rating,
                    "total_ratings": total_ratings,
                    "has_reviews": mid in self._catalog_review_counts,
                },
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def _popular_cold_start(self, top_k: int, media_type: str | None,
                            rated_ids: set[str]) -> list[dict]:
        """Fallback for users with no ratings: rank by quality signals."""
        self._load_catalog_quality()

        MIN_RATING = {"movie": 7.0, "tv": 7.0, "book": 3.5}
        MIN_TOTAL_RATINGS = {"movie": 100, "tv": 50, "book": 10}

        results = []
        for mid, rating in self._catalog_ratings.items():
            if mid in rated_ids:
                continue
            item_type = self.catalog_types.get(mid, mid.split("-")[0])
            if media_type and item_type != media_type:
                continue

            total_ratings = self._catalog_total_ratings.get(mid, 0)
            min_r = MIN_RATING.get(item_type, 7.0)
            min_n = MIN_TOTAL_RATINGS.get(item_type, 100)

            if rating < min_r or total_ratings < min_n:
                continue

            rating_norm = rating / 10.0 if item_type != "book" else rating / 5.0
            popularity_norm = min(total_ratings / 10000, 1.0)
            review_boost = 1.1 if mid in self._catalog_review_counts else 1.0

            score = (rating_norm * 0.6 + popularity_norm * 0.4) * review_boost

            results.append({
                "media_id": mid,
                "title": self.catalog_titles.get(mid, ""),
                "media_type": item_type,
                "genres": [],
                "score": round(score, 4),
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def _weighted_sample(self, results: list[dict], top_k: int) -> list[dict]:
        """Sample from candidates weighted by score, instead of strict top-k.

        Higher-scored items are more likely to be picked, but lower-scored
        items have a chance too. This gives meaningful variety on each refresh
        while keeping results relevant.

        The top 3 items are always included (anchor the list with strong picks),
        then the rest are sampled from the remaining pool.
        """
        if len(results) <= top_k:
            return results

        rng = np.random.default_rng()

        # Always include top 3 as anchors
        n_anchors = min(3, top_k)
        anchors = results[:n_anchors]
        pool = results[n_anchors:]
        n_sample = top_k - n_anchors

        if not pool or n_sample <= 0:
            return anchors

        # Convert scores to sampling weights (softmax-like)
        scores = np.array([r["score"] for r in pool])
        # Shift scores so they're all positive, then exponentiate for contrast
        scores = scores - scores.min() + 0.01
        weights = scores ** 2  # Square to favor higher scores but not exclusively
        weights = weights / weights.sum()

        chosen_indices = rng.choice(len(pool), size=min(n_sample, len(pool)), replace=False, p=weights)
        sampled = [pool[i] for i in sorted(chosen_indices)]

        # Re-sort combined list by score
        combined = anchors + sampled
        combined.sort(key=lambda x: x["score"], reverse=True)
        return combined

    def recommend(self, rated_items: list[dict], top_k: int = 20,
                  media_type: str | None = None, intent: str = "for_you") -> list[dict]:
        """Route to the right recommendation strategy based on intent.

        Fetches a large candidate pool, then uses weighted sampling
        to return top_k with variety on each call.

        Intents:
        - "for_you": Personalized picks (SVD + content-based)
        - "popular": What people love (CF + quality signal)
        """
        # Fetch a large pool to sample from
        fetch_k = top_k * 5

        if intent == "popular":
            results = self.recommend_popular(rated_items, fetch_k, media_type)
        else:
            results = self.recommend_for_you(rated_items, fetch_k, media_type)

        return self._weighted_sample(results, top_k)

    def embed_new_item(self, media_id: str, title: str, description: str,
                       genres: list[str] = [], media_type: str = "movie"):
        """Embed a new item on the fly and insert into Qdrant.

        Called when a user logs an item that isn't in our catalog.
        This ensures content-based recommendations can include it immediately.
        """
        if self.model is None:
            self.model = SentenceTransformer(settings.EMBEDDING_MODEL)

        # Build embedding text (same format as catalog items)
        genre_str = ", ".join(genres) if genres else ""
        parts = [title]
        if genre_str:
            parts.append(f"({genre_str})")
        if description:
            parts.append(f"- {description[:500]}")
        text = " ".join(parts)

        # Generate embedding
        vector = self.model.encode(text, normalize_embeddings=True).tolist()

        # Get next available point ID
        collection_info = self.qdrant.get_collection(settings.COLLECTION_NAME)
        next_id = collection_info.points_count

        # Insert into Qdrant
        self.qdrant.upsert(
            collection_name=settings.COLLECTION_NAME,
            points=[PointStruct(
                id=next_id,
                vector=vector,
                payload={
                    "media_id": media_id,
                    "title": title,
                    "media_type": media_type,
                    "genres": genres,
                    "description": description[:200],
                    "rating": 0,
                },
            )],
        )

        # Update local catalog lookups
        self.catalog_titles[media_id] = title
        self.catalog_types[media_id] = media_type

        return {"media_id": media_id, "status": "embedded", "point_id": next_id}

    def update_item_embedding(self, media_id: str, review_text: str):
        """Update an item's embedding by blending in a new user review.

        As users leave reviews, the item's embedding gradually shifts from
        pure catalog description toward community perception. This is how
        embeddings improve over time.
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        if self.model is None:
            self.model = SentenceTransformer(settings.EMBEDDING_MODEL)

        # Get current embedding
        points, _ = self.qdrant.scroll(
            collection_name=settings.COLLECTION_NAME,
            scroll_filter=Filter(must=[FieldCondition(key="media_id", match=MatchValue(value=media_id))]),
            limit=1,
            with_vectors=True,
        )

        if not points:
            return {"error": f"Item {media_id} not found"}

        current_vec = np.array(points[0].vector)
        point_id = points[0].id

        # Embed the review
        review_vec = self.model.encode(review_text, normalize_embeddings=True)

        # Blend: 90% current + 10% new review (gradual shift)
        # This means after ~10 reviews, the embedding has shifted significantly
        blended = 0.9 * current_vec + 0.1 * review_vec
        norm = np.linalg.norm(blended)
        if norm > 0:
            blended = blended / norm

        # Update in Qdrant
        self.qdrant.upsert(
            collection_name=settings.COLLECTION_NAME,
            points=[PointStruct(
                id=point_id,
                vector=blended.tolist(),
                payload=points[0].payload,
            )],
        )

        return {"media_id": media_id, "status": "updated"}


# Module-level instance
_router: RecommendationRouter | None = None
_router_lock = threading.Lock()


def get_router() -> RecommendationRouter:
    global _router
    if _router is not None:
        return _router
    with _router_lock:
        if _router is None:
            instance = RecommendationRouter()
            instance.load()
            _router = instance
    return _router


def demo():
    router = get_router()

    user_ratings = [
        {"media_id": "movie-550", "rating": 5.0},    # Fight Club
        {"media_id": "movie-680", "rating": 4.5},     # Pulp Fiction
        {"media_id": "movie-603", "rating": 4.0},     # The Matrix
        {"media_id": "movie-155", "rating": 5.0},     # The Dark Knight
    ]

    print("\nUser rated: Fight Club (5), Pulp Fiction (4.5), The Matrix (4), Dark Knight (5)")

    print("\n=== FOR YOU (personalized — SVD + content-based) ===")
    recs = router.recommend(user_ratings, top_k=10, intent="for_you")
    for r in recs:
        signals = r.get("_signals", {})
        w = signals.get("weights", {})
        print(f"  {r['score']:.4f}  [{r['media_type']}] {r['title']:<40} "
              f"CB={signals.get('content',0):.3f} SVD={signals.get('svd',0):.3f} "
              f"w_cb={w.get('cb',0):.0%} w_svd={w.get('svd',0):.0%}")

    print("\n=== PEOPLE LOVE (community picks — CF popularity) ===")
    recs = router.recommend(user_ratings, top_k=10, intent="popular")
    for r in recs:
        print(f"  {r['score']:.4f}  [{r['media_type']}] {r['title']}")

    print("\n=== FOR YOU: Books (cross-type) ===")
    recs = router.recommend(user_ratings, top_k=5, media_type="book", intent="for_you")
    for r in recs:
        print(f"  {r['score']:.4f}  [{r['media_type']}] {r['title']}")

    print("\n=== FOR YOU: TV Shows ===")
    recs = router.recommend(user_ratings, top_k=5, media_type="tv", intent="for_you")
    for r in recs:
        print(f"  {r['score']:.4f}  [{r['media_type']}] {r['title']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()
    if args.demo:
        demo()
