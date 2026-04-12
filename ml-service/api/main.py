from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer

from config import settings
from embeddings.search import (
    find_similar,
    recommend_for_user,
    search_by_text,
)
from models.collaborative import recommend_cf
from models.hybrid import recommend_hybrid
from models.router import get_router

# --- Shared resources (loaded once at startup) ---
model: SentenceTransformer | None = None
qdrant: QdrantClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model and connect to Qdrant on startup."""
    global model, qdrant
    print("Loading embedding model...")
    model = SentenceTransformer(settings.EMBEDDING_MODEL)
    print("Connecting to Qdrant...")
    qdrant = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
    print("ML service ready.")
    yield
    print("Shutting down.")


app = FastAPI(
    title="MediaMatch ML Service",
    description="Recommendation engine with content-based filtering, collaborative filtering, and hybrid ranking.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request/Response schemas ---

class RatedItem(BaseModel):
    media_id: str
    rating: float
    review: str = ""


class RecommendationRequest(BaseModel):
    rated_items: list[RatedItem]
    top_k: int = 20
    media_type: str | None = None
    intent: str = "for_you"  # "for_you" or "popular"


class RecommendationItem(BaseModel):
    media_id: str
    title: str
    media_type: str
    genres: list[str]
    score: float


class RecommendationResponse(BaseModel):
    method: str
    recommendations: list[RecommendationItem]
    count: int


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10
    media_type: str | None = None


# --- Endpoints ---

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "mediamatch-ml"}


@app.post("/recommendations/content-based", response_model=RecommendationResponse)
def content_based_recommendations(req: RecommendationRequest):
    """Content-based recommendations using media embeddings + user taste vector.

    Accepts the user's rated items (with optional reviews). Computes a taste
    vector by averaging catalog embeddings with review embeddings (when provided),
    weighted by rating. Returns nearest items in embedding space.
    """
    if not req.rated_items:
        raise HTTPException(status_code=400, detail="No rated items provided")

    rated_dicts = [item.model_dump() for item in req.rated_items]
    results = recommend_for_user(
        rated_items=rated_dicts,
        top_k=req.top_k,
        media_type=req.media_type,
    )

    return RecommendationResponse(
        method="content-based",
        recommendations=[RecommendationItem(**r) for r in results],
        count=len(results),
    )


@app.get("/similar/{media_id}")
def similar_items(media_id: str, top_k: int = 10):
    """Find items similar to a given media item."""
    results = find_similar(media_id=media_id, top_k=top_k)
    if isinstance(results, dict) and "error" in results:
        raise HTTPException(status_code=404, detail=results["error"])
    return {"media_id": media_id, "similar": results, "count": len(results)}


@app.post("/search", response_model=RecommendationResponse)
def semantic_search(req: SearchRequest):
    """Semantic search over media embeddings using free text."""
    results = search_by_text(
        query=req.query,
        top_k=req.top_k,
        media_type=req.media_type,
    )
    return RecommendationResponse(
        method="semantic-search",
        recommendations=[RecommendationItem(**r) for r in results],
        count=len(results),
    )


@app.post("/recommendations/collaborative", response_model=RecommendationResponse)
def collaborative_recommendations(req: RecommendationRequest):
    """Collaborative filtering recommendations from user rating patterns.

    Uses item-item cosine similarity on MovieLens (movies) and Goodreads (books)
    rating matrices. Scores each candidate item by its weighted similarity
    to the user's rated items.
    """
    if not req.rated_items:
        raise HTTPException(status_code=400, detail="No rated items provided")

    rated_dicts = [item.model_dump() for item in req.rated_items]
    results = recommend_cf(
        rated_items=rated_dicts,
        top_k=req.top_k,
        media_type=req.media_type,
    )

    # Enrich with media_type and genres from title (CF only returns media_id, title, score)
    recs = []
    for r in results:
        media_type = r["media_id"].split("-")[0]
        recs.append(RecommendationItem(
            media_id=r["media_id"],
            title=r.get("title", ""),
            media_type=media_type,
            genres=[],
            score=r["score"],
        ))

    return RecommendationResponse(
        method="collaborative",
        recommendations=recs,
        count=len(recs),
    )


@app.post("/recommendations/hybrid", response_model=RecommendationResponse)
def hybrid_recommendations(req: RecommendationRequest):
    """Hybrid recommendations combining content-based, CF, and SVD.

    Uses a trained GradientBoosting model to blend scores from all
    three recommendation approaches.
    """
    if not req.rated_items:
        raise HTTPException(status_code=400, detail="No rated items provided")

    rated_dicts = [item.model_dump() for item in req.rated_items]
    results = recommend_hybrid(
        rated_items=rated_dicts,
        top_k=req.top_k,
        media_type=req.media_type,
    )

    return RecommendationResponse(
        method="hybrid",
        recommendations=[RecommendationItem(**r) for r in results],
        count=len(results),
    )


@app.post("/recommendations/smart", response_model=RecommendationResponse)
def smart_recommendations(req: RecommendationRequest):
    """Smart router — uses the best model for each candidate item.

    Dynamically weights content-based, CF, and SVD based on what
    signal is available. For new users with no ratings, returns
    popular/trending items as a cold-start fallback.
    """
    router = get_router()
    rated_dicts = [item.model_dump() for item in req.rated_items]
    results = router.recommend(
        rated_items=rated_dicts,
        top_k=req.top_k,
        media_type=req.media_type,
        intent=req.intent,
    )

    return RecommendationResponse(
        method="smart-router",
        recommendations=[RecommendationItem(
            media_id=r["media_id"],
            title=r["title"],
            media_type=r["media_type"],
            genres=r["genres"],
            score=r["score"],
        ) for r in results],
        count=len(results),
    )


class EmbedItemRequest(BaseModel):
    media_id: str
    title: str
    description: str
    genres: list[str] = []
    media_type: str = "movie"


class UpdateEmbeddingRequest(BaseModel):
    media_id: str
    review_text: str


@app.post("/items/embed")
def embed_new_item(req: EmbedItemRequest):
    """Embed a new item on the fly when a user logs something not in our catalog.

    This ensures content-based recommendations can include the item immediately,
    without waiting for a batch re-embedding job.
    """
    router = get_router()
    result = router.embed_new_item(
        media_id=req.media_id,
        title=req.title,
        description=req.description,
        genres=req.genres,
        media_type=req.media_type,
    )
    return result


@app.post("/items/update-embedding")
def update_item_embedding(req: UpdateEmbeddingRequest):
    """Update an item's embedding by blending in a user review.

    Called when a user writes a review. Gradually shifts the item's
    embedding from pure catalog description toward community perception.
    After ~10 reviews, the embedding significantly reflects how users
    actually experience the item.
    """
    router = get_router()
    result = router.update_item_embedding(req.media_id, req.review_text)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
