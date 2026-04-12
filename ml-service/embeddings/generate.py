"""Generate embeddings for all media items and store in Qdrant.

Uses sentence-transformers (all-MiniLM-L6-v2) to embed each item's
title + genres + description into a 384-dim vector. Stores vectors
in Qdrant with full metadata for filtered search.

Usage:
    python -m embeddings.generate
"""

import json
import json
import os

import pandas as pd
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

from config import settings
from data.schema import MediaDocument

BATCH_SIZE = 128  # Encode this many texts at once (GPU/CPU batch)


def load_catalog() -> list[MediaDocument]:
    """Load all media items from the processed catalog."""
    catalog_path = os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet")
    df = pd.read_parquet(catalog_path)

    def clean(val):
        """Convert NaN/None to None for optional Pydantic fields."""
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        return val

    docs = []
    for _, row in df.iterrows():
        doc = MediaDocument(
            id=row["id"],
            external_id=row["external_id"],
            media_type=row["media_type"],
            title=row["title"],
            description=row["description"] if pd.notna(row["description"]) else "",
            genres=row["genres"] if isinstance(row["genres"], list) else [],
            year=clean(row.get("year")),
            cover_image=clean(row.get("cover_image")),
            rating=row.get("rating", 0) if pd.notna(row.get("rating", 0)) else 0,
            total_ratings=int(row.get("total_ratings", 0)) if pd.notna(row.get("total_ratings", 0)) else 0,
            authors=row.get("authors") if isinstance(row.get("authors"), list) else None,
            source=row.get("source", "") if pd.notna(row.get("source", "")) else "",
        )
        docs.append(doc)

    return docs


def main():
    # --- Load model ---
    print(f"Loading embedding model: {settings.EMBEDDING_MODEL}")
    model = SentenceTransformer(settings.EMBEDDING_MODEL)
    print(f"  Embedding dimension: {model.get_sentence_embedding_dimension()}")

    # --- Load catalog ---
    print("\nLoading catalog...")
    docs = load_catalog()
    print(f"  {len(docs)} media items")

    # --- Load improved descriptions (Wikipedia intros for all types) ---
    improved_descs_path = os.path.join(settings.PROCESSED_DIR, "descriptions_improved.json")
    if not os.path.exists(improved_descs_path):
        # Fall back to book-only file
        improved_descs_path = os.path.join(settings.PROCESSED_DIR, "book_descriptions_improved.json")
    improved_descs = {}
    if os.path.exists(improved_descs_path):
        with open(improved_descs_path) as f:
            improved_descs = json.load(f)
        print(f"  Loaded improved descriptions for {len(improved_descs)} items")
        for doc in docs:
            if doc.id in improved_descs:
                doc.description = improved_descs[doc.id]

    # --- Load reviews (if available) ---
    reviews_path = os.path.join(settings.PROCESSED_DIR, "media_reviews.json")
    reviews_map = {}
    if os.path.exists(reviews_path):
        with open(reviews_path) as f:
            reviews_map = json.load(f)
        print(f"  Loaded reviews for {len(reviews_map)} items")
    else:
        print("  No reviews file found — using catalog descriptions only")

    # --- Build embedding texts (description + reviews) ---
    print("\nGenerating embeddings...")
    texts = []
    items_with_reviews = 0
    for doc in docs:
        text = doc.embedding_text
        if doc.id in reviews_map:
            review_snippets = " ".join(reviews_map[doc.id])
            text = f"{text} Reviews: {review_snippets}"
            items_with_reviews += 1
        texts.append(text)

    print(f"  {items_with_reviews} items enriched with reviews, {len(docs) - items_with_reviews} catalog-only")

    # Encode in batches with progress bar
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        normalize_embeddings=True,  # L2 normalize for cosine similarity
    )
    print(f"  Generated {len(embeddings)} embeddings of dim {embeddings.shape[1]}")

    # --- Store in Qdrant ---
    print("\nConnecting to Qdrant...")
    client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)

    # Recreate collection (idempotent)
    collection_name = settings.COLLECTION_NAME
    client.recreate_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=settings.EMBEDDING_DIM,
            distance=Distance.COSINE,
        ),
    )

    # Upload in batches
    print(f"Uploading to collection '{collection_name}'...")
    points = []
    for i, (doc, embedding) in enumerate(zip(docs, embeddings)):
        point = PointStruct(
            id=i,
            vector=embedding.tolist(),
            payload={
                "media_id": doc.id,
                "title": doc.title,
                "media_type": doc.media_type,
                "genres": doc.genres,
                "year": doc.year,
                "rating": doc.rating,
                "description": doc.description[:200],  # Truncate for storage
            },
        )
        points.append(point)

        # Upload in batches of 500
        if len(points) >= 500:
            client.upsert(collection_name=collection_name, points=points)
            points = []

    # Upload remaining
    if points:
        client.upsert(collection_name=collection_name, points=points)

    # Verify
    info = client.get_collection(collection_name)
    print(f"\nDone! Collection '{collection_name}': {info.points_count} vectors stored")


if __name__ == "__main__":
    main()
