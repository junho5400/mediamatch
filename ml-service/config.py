import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # API keys
    TMDB_API_KEY: str = os.getenv("TMDB_API_KEY", "")
    GOOGLE_BOOKS_API_KEY: str = os.getenv("GOOGLE_BOOKS_API_KEY", "")

    # Qdrant
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", "6333"))
    COLLECTION_NAME: str = "media_embeddings"

    # Embedding model
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    EMBEDDING_DIM: int = 384  # output dim for MiniLM-L6-v2

    # Paths
    DATA_DIR: str = os.path.join(os.path.dirname(__file__), "data", "raw")
    PROCESSED_DIR: str = os.path.join(os.path.dirname(__file__), "data", "processed")

    # Recommendation defaults
    DEFAULT_TOP_K: int = 20


settings = Settings()
