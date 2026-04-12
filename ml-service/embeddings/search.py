"""Query functions for finding similar media via embeddings.

Provides:
- find_similar(media_id): find items similar to a given item
- search_by_text(query): semantic search by free text
- get_user_recommendations(rated_items): content-based recs from user taste vector

Usage:
    python -m embeddings.search --demo
"""

import argparse

import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
from sentence_transformers import SentenceTransformer

from config import settings


def get_client() -> QdrantClient:
    return QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)


def get_model() -> SentenceTransformer:
    return SentenceTransformer(settings.EMBEDDING_MODEL)


def _query_qdrant(client: QdrantClient, vector: list, top_k: int, query_filter=None):
    """Wrapper around qdrant query_points (v1.11+ API)."""
    response = client.query_points(
        collection_name=settings.COLLECTION_NAME,
        query=vector,
        query_filter=query_filter,
        limit=top_k,
        with_payload=True,
    )
    return response.points


def find_similar(media_id: str, top_k: int = 10, exclude_same_type: bool = False):
    """Find items most similar to a given media item."""
    client = get_client()
    collection = settings.COLLECTION_NAME

    # Find the point by media_id
    points, _ = client.scroll(
        collection_name=collection,
        scroll_filter=Filter(must=[FieldCondition(key="media_id", match=MatchValue(value=media_id))]),
        limit=1,
        with_vectors=True,
    )

    if not points:
        return {"error": f"Media ID '{media_id}' not found in embeddings"}

    query_vector = points[0].vector

    # Build filter
    search_filter = None
    if exclude_same_type:
        media_type = points[0].payload.get("media_type", "")
        search_filter = Filter(
            must_not=[FieldCondition(key="media_type", match=MatchValue(value=media_type))]
        )

    hits = _query_qdrant(client, query_vector, top_k + 1, search_filter)

    results = []
    for hit in hits:
        if hit.payload.get("media_id") != media_id:
            results.append({
                "media_id": hit.payload["media_id"],
                "title": hit.payload["title"],
                "media_type": hit.payload["media_type"],
                "genres": hit.payload.get("genres", []),
                "score": round(hit.score, 4),
            })
        if len(results) >= top_k:
            break

    return results


def search_by_text(query: str, top_k: int = 10, media_type: str | None = None):
    """Semantic search — embed the query text and find nearest media."""
    client = get_client()
    model = get_model()

    query_vector = model.encode(query, normalize_embeddings=True).tolist()

    search_filter = None
    if media_type:
        search_filter = Filter(
            must=[FieldCondition(key="media_type", match=MatchValue(value=media_type))]
        )

    hits = _query_qdrant(client, query_vector, top_k, search_filter)

    return [
        {
            "media_id": hit.payload["media_id"],
            "title": hit.payload["title"],
            "media_type": hit.payload["media_type"],
            "genres": hit.payload.get("genres", []),
            "score": round(hit.score, 4),
        }
        for hit in hits
    ]


def _get_item_vector(
    item: dict, client: QdrantClient, model: SentenceTransformer | None = None
) -> np.ndarray | None:
    """Get the embedding vector for a single rated item.

    If the user provided a review, we average the catalog embedding with
    the review embedding. This blends objective content ("what this media is")
    with subjective perception ("how this user experienced it").

    Items without reviews use the catalog embedding as-is.

    Args:
        item: {"media_id": str, "rating": float, "review": str (optional)}
        client: Qdrant client
        model: Sentence transformer (loaded lazily if needed for review embedding)
    """
    collection = settings.COLLECTION_NAME

    # Get catalog embedding from Qdrant
    points, _ = client.scroll(
        collection_name=collection,
        scroll_filter=Filter(
            must=[FieldCondition(key="media_id", match=MatchValue(value=item["media_id"]))]
        ),
        limit=1,
        with_vectors=True,
    )

    if not points:
        return None

    catalog_vec = np.array(points[0].vector)

    # If user wrote a review, blend it with the catalog embedding
    review = item.get("review", "").strip()
    if review and len(review) > 20:  # Ignore very short reviews like "good"
        if model is None:
            model = get_model()
        review_vec = model.encode(review, normalize_embeddings=True)
        # Average catalog + review vectors (equal weight)
        blended = (catalog_vec + review_vec) / 2
        # Re-normalize
        norm = np.linalg.norm(blended)
        if norm > 0:
            blended = blended / norm
        return blended

    return catalog_vec


def get_user_taste_vector(rated_items: list[dict], client: QdrantClient) -> np.ndarray | None:
    """Compute a user's taste vector as the mean-centered weighted centroid.

    Ratings are centered around the user's mean rating:
    - Items rated ABOVE average → positive weight (push toward)
    - Items rated BELOW average → negative weight (push away)
    - Items rated exactly average → zero weight (neutral)

    This means a 1-star rating actively pushes the taste vector AWAY from
    that item's embedding, rather than contributing positively.

    Args:
        rated_items: List of {"media_id": str, "rating": float, "review": str (optional)}
    """
    # Only load the model if we actually have reviews to embed
    has_reviews = any(item.get("review", "").strip() and len(item.get("review", "")) > 20 for item in rated_items)
    model = get_model() if has_reviews else None

    # Collect vectors and ratings
    item_vectors = []
    item_ratings = []
    for item in rated_items:
        vec = _get_item_vector(item, client, model)
        if vec is not None:
            item_vectors.append(vec)
            item_ratings.append(item["rating"])

    if not item_vectors:
        return None

    vectors = np.array(item_vectors)
    ratings = np.array(item_ratings)

    # Mean-center ratings so below-average items have negative weight
    mean_rating = ratings.mean()
    centered_weights = ratings - mean_rating

    # If all ratings are identical (no signal), fall back to equal weights
    if np.allclose(centered_weights, 0):
        centroid = vectors.mean(axis=0)
    else:
        centroid = np.zeros(vectors.shape[1])
        for vec, w in zip(vectors, centered_weights):
            centroid += vec * w

    norm = np.linalg.norm(centroid)
    if norm > 0:
        centroid = centroid / norm

    return centroid


def recommend_for_user(
    rated_items: list[dict], top_k: int = 20, media_type: str | None = None
) -> list[dict]:
    """Content-based recommendations from a user's rated items."""
    client = get_client()

    taste_vector = get_user_taste_vector(rated_items, client)
    if taste_vector is None:
        return []

    rated_ids = {item["media_id"] for item in rated_items}

    search_filter = None
    if media_type:
        search_filter = Filter(
            must=[FieldCondition(key="media_type", match=MatchValue(value=media_type))]
        )

    hits = _query_qdrant(client, taste_vector.tolist(), top_k + len(rated_ids), search_filter)

    results = []
    for hit in hits:
        if hit.payload.get("media_id") not in rated_ids:
            results.append({
                "media_id": hit.payload["media_id"],
                "title": hit.payload["title"],
                "media_type": hit.payload["media_type"],
                "genres": hit.payload.get("genres", []),
                "score": round(hit.score, 4),
            })
        if len(results) >= top_k:
            break

    return results


def demo():
    """Run a quick demo to verify embeddings are working."""
    print("=== Similar Items Demo ===")
    print("\nItems similar to 'movie-550' (Fight Club):")
    results = find_similar("movie-550", top_k=5)
    if isinstance(results, dict) and "error" in results:
        print(f"  {results['error']}")
    else:
        for item in results:
            print(f"  {item['score']:.3f}  [{item['media_type']}] {item['title']} — {item['genres']}")

    print("\n=== Semantic Search Demo ===")
    queries = [
        "dark psychological thriller with plot twists",
        "heartwarming coming-of-age story",
        "epic space opera with aliens",
    ]
    for query in queries:
        print(f"\nQuery: '{query}'")
        for item in search_by_text(query, top_k=3):
            print(f"  {item['score']:.3f}  [{item['media_type']}] {item['title']}")

    print("\n=== User Recommendation Demo (without reviews) ===")
    user_no_reviews = [
        {"media_id": "movie-550", "rating": 5.0},    # Fight Club
        {"media_id": "movie-603", "rating": 4.5},     # The Matrix
    ]
    print("\nRecs for user who likes Fight Club (5.0) + The Matrix (4.5):")
    for item in recommend_for_user(user_no_reviews, top_k=5):
        print(f"  {item['score']:.3f}  [{item['media_type']}] {item['title']} — {item['genres']}")

    print("\n=== User Recommendation Demo (with reviews) ===")
    user_with_reviews = [
        {"media_id": "movie-550", "rating": 5.0,
         "review": "A dark exploration of identity, masculinity, and the emptiness of consumer culture. The twist completely reframes everything."},
        {"media_id": "movie-603", "rating": 4.5,
         "review": "Philosophically rich sci-fi questioning the nature of reality. The action is great but the ideas are what stick with you."},
    ]
    print("\nSame user, but with reviews about philosophy and identity:")
    for item in recommend_for_user(user_with_reviews, top_k=5):
        print(f"  {item['score']:.3f}  [{item['media_type']}] {item['title']} — {item['genres']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    if args.demo:
        demo()
