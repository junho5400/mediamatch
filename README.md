# MediaMatch

A recommendation platform for books, movies, and TV — built around a real ML pipeline rather than a single LLM prompt. Users log what they watch and read, rate and review it, and MediaMatch learns their taste and suggests what to try next.

The goal of this project is to demonstrate end-to-end ML engineering: embedding generation, vector search, collaborative filtering, a hybrid ranker, offline evaluation, and the supporting infrastructure to serve it all in a working product.

## What it does

- **Log media** across books, movies, and TV from a unified catalog (TMDB + Google Books).
- **Rate, tag, and review** items. Reviews feed back into the embeddings — an item's vector gradually shifts from its catalog description toward how real users describe it.
- **Get recommendations** from a smart router that picks between content-based, collaborative, and hybrid scoring depending on what signal is available for each candidate.
- **Browse a profile** with a taste summary, AI-generated report, and library breakdown.
- **Chat with an assistant** that knows your library and can recommend or compare titles conversationally.

## Architecture

```
┌────────────────┐        ┌──────────────────┐        ┌─────────────┐
│   Next.js 15   │  ───►  │   FastAPI ML     │  ───►  │   Qdrant    │
│  (app router)  │        │     service      │        │ (vectors)   │
└───────┬────────┘        └────────┬─────────┘        └─────────────┘
        │                          │
        │                          └──► trained models (SVD, hybrid ranker)
        │
        ▼
┌────────────────┐
│   Firestore    │  user library, ratings, reviews, AI reports
└────────────────┘
```

- **Frontend** — Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui. Firebase Auth + Firestore for user data. API routes proxy to the ML service.
- **ML service** — FastAPI, Python 3.13. Serves recommendations, semantic search, and on-the-fly embedding of new items.
- **Vector DB** — Qdrant running locally in Docker. Stores item embeddings with metadata for fast similarity search.
- **Gemini** — used only for presentation: chatbot replies and natural-language AI reports. It is **not** the recommendation engine.

## The recommendation stack

| Approach                | What it uses                                                              | When it wins                          |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| **Content-based**       | `sentence-transformers/all-MiniLM-L6-v2` embeddings over titles + descriptions + genres + reviews | New items, cold items, text-heavy taste |
| **Collaborative (item-item)** | Cosine similarity over MovieLens 25M ratings (movies) and Goodreads ratings (books) | Items with many co-raters, taste-herd signal |
| **SVD matrix factorization**  | Latent factor model trained on the same rating matrices | Popular items with dense signal |
| **Hybrid ranker**       | GradientBoosting over features from all three above                       | General case — blends signals per candidate |
| **Smart router**        | Picks the best-available method per candidate and per intent (`for_you` vs `popular`) | Runtime — what the API actually serves |

Offline evaluation uses NDCG@k, Precision@k, and RMSE. Experiment runs are tracked locally with MLflow.

### Why a hybrid, not just an LLM?

Pure LLM recommendations drift, hallucinate titles, and can't leverage collaborative signal from tens of millions of real users. A hybrid retrieval + ranking system is how production RecSys actually work (Netflix, Spotify, Amazon all run variants of this). This project is a compact but honest version of that pattern.

### Review-aware embeddings

When a user writes a review, the item's vector is updated as a weighted blend of its current embedding and the review text embedding. After ~10 reviews, the item's position in vector space has shifted meaningfully from "what the catalog says it is" to "how people actually experience it." This closes the feedback loop between user signal and the content model.

## Tech stack

**Frontend**
- Next.js 15 (App Router, TypeScript)
- Tailwind CSS + shadcn/ui
- Firebase (Auth, Firestore, Admin SDK)
- Zod for validation

**ML service**
- FastAPI
- sentence-transformers (`all-MiniLM-L6-v2`)
- Qdrant
- scikit-learn (hybrid ranker)
- scipy + numpy (CF, SVD)
- MLflow (local experiment tracking)

**Data**
- TMDB API (movies, TV)
- Google Books API (books)
- MovieLens 25M (CF training)
- Goodreads public ratings (CF training)

## Setup

### Prerequisites

- Node.js 20+
- Python 3.13+
- Docker (for Qdrant)
- Firebase project (Auth + Firestore enabled)
- API keys: TMDB, Google Books, Gemini, Firebase

### Frontend

```bash
npm install --legacy-peer-deps
cp .env.example .env.local
# fill in Firebase, TMDB, Google Books, Gemini keys
npm run dev
```

Frontend runs on http://localhost:3000.

### ML service

```bash
cd ml-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# fill in TMDB, Google Books keys
```

Start Qdrant:

```bash
docker compose up qdrant -d
```

Start the ML service:

```bash
cd ml-service
uvicorn api.main:app --reload --port 8000
```

ML service runs on http://localhost:8000. API docs at http://localhost:8000/docs.

### Data

The repo ships with pre-built embeddings and trained model checkpoints so the service works on clone. To rebuild from raw sources:

```bash
cd ml-service
python data/ingest_tmdb.py       # pulls movie/TV metadata from TMDB
python data/ingest_books.py      # pulls book metadata from Google Books
python data/ingest_movielens.py  # downloads + processes MovieLens 25M
python data/ingest_goodreads.py  # processes Goodreads ratings
python data/merge_catalog.py     # builds the unified media catalog
```

Then embed and index:

```bash
python -m embeddings.build_index
python -m models.train_svd
python -m models.train_hybrid
```

### Environment variables

**Frontend (`.env.local`)** — see `.env.example` for the full list:
- `NEXT_PUBLIC_FIREBASE_*` — Firebase client config
- `FIREBASE_*` — Firebase Admin SDK (server-only)
- `NEXT_PUBLIC_TMDB_API_KEY`, `NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY`
- `GEMINI_API_KEY` — server-only, never prefixed with `NEXT_PUBLIC_`
- `ML_SERVICE_URL` — defaults to `http://localhost:8000`

**ML service (`ml-service/.env`)**:
- `TMDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`
- `QDRANT_HOST`, `QDRANT_PORT`

## Project layout

```
mediamatch/
├── app/                    Next.js app router — pages, API routes
├── components/             React components (shadcn/ui in ui/)
├── lib/                    Frontend libs (firebase, gemini, recommendations, validation)
├── types/                  Shared TS types
├── public/                 Static assets
├── middleware.ts           Security headers, CSP
├── firestore.rules         Firestore security rules
├── docker-compose.yml      Qdrant service
└── ml-service/
    ├── api/                FastAPI app
    ├── embeddings/         sentence-transformers + Qdrant indexing, search
    ├── models/             CF, SVD, hybrid ranker, smart router
    ├── data/               Ingestion pipelines for TMDB, Books, MovieLens, Goodreads
    ├── evaluation/         Offline eval (NDCG, P@k, RMSE)
    └── requirements.txt
```

## License

MIT
