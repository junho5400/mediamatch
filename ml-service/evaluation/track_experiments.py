"""Log all model training runs and evaluation metrics to MLflow.

This retroactively records our experiments so they're visible in the
MLflow UI for the portfolio. Run once after training all models.

Usage:
    python -m evaluation.track_experiments
    mlflow ui --port 5000  # Then open http://localhost:5000
"""

import json
import os

import mlflow
import numpy as np
import pandas as pd
from scipy import sparse

from config import settings

RESULTS_PATH = os.path.join(os.path.dirname(__file__), "results", "model_comparison.json")
MLFLOW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "mlruns")


def safe_metric_name(name: str) -> str:
    """Replace characters MLflow doesn't allow in metric names."""
    return name.replace("@", "_at_")


def log_data_stats():
    """Log dataset statistics as a run."""
    with mlflow.start_run(run_name="data-pipeline"):
        mlflow.set_tag("stage", "data")

        # Media catalog
        catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
        mlflow.log_metric("catalog_total_items", len(catalog))
        mlflow.log_metric("catalog_movies", len(catalog[catalog["media_type"] == "movie"]))
        mlflow.log_metric("catalog_tv", len(catalog[catalog["media_type"] == "tv"]))
        mlflow.log_metric("catalog_books", len(catalog[catalog["media_type"] == "book"]))

        # MovieLens
        movie_matrix = sparse.load_npz(os.path.join(settings.PROCESSED_DIR, "rating_matrix.npz"))
        mlflow.log_metric("movielens_users", movie_matrix.shape[0])
        mlflow.log_metric("movielens_items", movie_matrix.shape[1])
        mlflow.log_metric("movielens_ratings", movie_matrix.nnz)
        mlflow.log_metric("movielens_sparsity", 1 - movie_matrix.nnz / (movie_matrix.shape[0] * movie_matrix.shape[1]))

        # Goodreads
        book_matrix = sparse.load_npz(os.path.join(settings.PROCESSED_DIR, "book_rating_matrix.npz"))
        mlflow.log_metric("goodreads_users", book_matrix.shape[0])
        mlflow.log_metric("goodreads_items", book_matrix.shape[1])
        mlflow.log_metric("goodreads_ratings", book_matrix.nnz)

        # Reviews
        reviews_path = os.path.join(settings.PROCESSED_DIR, "media_reviews.json")
        if os.path.exists(reviews_path):
            with open(reviews_path) as f:
                reviews = json.load(f)
            mlflow.log_metric("items_with_reviews", len(reviews))
            mlflow.log_metric("review_coverage", len(reviews) / len(catalog))

        # Embeddings
        mlflow.log_param("embedding_model", settings.EMBEDDING_MODEL)
        mlflow.log_param("embedding_dim", settings.EMBEDDING_DIM)

        print("  Logged data pipeline stats")


def log_content_based():
    """Log content-based model details."""
    with mlflow.start_run(run_name="content-based"):
        mlflow.set_tag("stage", "model")
        mlflow.set_tag("model_type", "content-based")

        mlflow.log_param("embedding_model", "all-MiniLM-L6-v2")
        mlflow.log_param("embedding_dim", 384)
        mlflow.log_param("vector_db", "Qdrant")
        mlflow.log_param("distance_metric", "cosine")
        mlflow.log_param("user_vector_method", "weighted_centroid")
        mlflow.log_param("review_blending", "50/50 catalog+review")

        # Load eval results
        if os.path.exists(RESULTS_PATH):
            with open(RESULTS_PATH) as f:
                results = json.load(f)
            if "content_based" in results:
                for k, v in results["content_based"].items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(safe_metric_name(k), v)

        print("  Logged content-based model")


def log_item_item_cf():
    """Log item-item CF model details."""
    with mlflow.start_run(run_name="item-item-cf"):
        mlflow.set_tag("stage", "model")
        mlflow.set_tag("model_type", "collaborative-filtering")

        mlflow.log_param("method", "item-item cosine similarity")
        mlflow.log_param("min_ratings", 5)
        mlflow.log_param("filtered_to_catalog", True)
        mlflow.log_param("movie_items", 3172)
        mlflow.log_param("book_items", 1390)

        if os.path.exists(RESULTS_PATH):
            with open(RESULTS_PATH) as f:
                results = json.load(f)
            if "item_item_cf" in results:
                for k, v in results["item_item_cf"].items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(safe_metric_name(k), v)

        print("  Logged item-item CF model")


def log_svd():
    """Log SVD model details."""
    with mlflow.start_run(run_name="svd-movies"):
        mlflow.set_tag("stage", "model")
        mlflow.set_tag("model_type", "matrix-factorization")

        mlflow.log_param("method", "TruncatedSVD")
        mlflow.log_param("n_factors", 100)
        mlflow.log_param("dataset", "MovieLens 25M")
        mlflow.log_metric("cv_rmse", 0.9853)
        mlflow.log_metric("explained_variance_ratio", 0.2642)

        if os.path.exists(RESULTS_PATH):
            with open(RESULTS_PATH) as f:
                results = json.load(f)
            if "svd" in results:
                for k, v in results["svd"].items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(safe_metric_name(k), v)

        print("  Logged SVD movie model")

    with mlflow.start_run(run_name="svd-books"):
        mlflow.set_tag("stage", "model")
        mlflow.set_tag("model_type", "matrix-factorization")

        mlflow.log_param("method", "TruncatedSVD")
        mlflow.log_param("n_factors", 50)
        mlflow.log_param("dataset", "Goodreads")
        mlflow.log_metric("cv_rmse", 0.9918)
        mlflow.log_metric("explained_variance_ratio", 0.6742)

        print("  Logged SVD book model")


def log_hybrid():
    """Log hybrid ranker details."""
    with mlflow.start_run(run_name="hybrid-ranker"):
        mlflow.set_tag("stage", "model")
        mlflow.set_tag("model_type", "hybrid")

        mlflow.log_param("method", "GradientBoosting classifier")
        mlflow.log_param("n_estimators", 100)
        mlflow.log_param("max_depth", 3)
        mlflow.log_metric("cv_auc", 0.7338)
        mlflow.log_param("feature_importance_cf", 0.8593)
        mlflow.log_param("feature_importance_svd", 0.1407)

        if os.path.exists(RESULTS_PATH):
            with open(RESULTS_PATH) as f:
                results = json.load(f)
            if "hybrid" in results:
                for k, v in results["hybrid"].items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(safe_metric_name(k), v)

        print("  Logged hybrid ranker")


def log_smart_router():
    """Log the smart router architecture."""
    with mlflow.start_run(run_name="smart-router"):
        mlflow.set_tag("stage", "production")
        mlflow.set_tag("model_type", "router")

        mlflow.log_param("for_you_models", "SVD + content-based")
        mlflow.log_param("people_love_models", "CF + quality ranking")
        mlflow.log_param("svd_weight", 0.77)
        mlflow.log_param("content_weight", 0.23)
        mlflow.log_param("cf_personalization_weight", 0.20)
        mlflow.log_param("quality_weight", 0.80)
        mlflow.log_param("exploration_strategy", "weighted_sampling")
        mlflow.log_param("cold_start_fallback", "quality_ranking")
        mlflow.log_param("on_the_fly_embedding", True)
        mlflow.log_param("review_embedding_updates", True)

        print("  Logged smart router")


def main():
    # Use SQLite backend (recommended over filesystem)
    db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "mlflow.db")
    mlflow.set_tracking_uri(f"sqlite:///{db_path}")
    mlflow.set_experiment("MediaMatch-RecSys")

    print("Logging experiments to MLflow...")
    log_data_stats()
    log_content_based()
    log_item_item_cf()
    log_svd()
    log_hybrid()
    log_smart_router()

    db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "mlflow.db")
    print(f"\nDone! View with: mlflow ui --backend-store-uri sqlite:///{db_path} --port 5000")


if __name__ == "__main__":
    main()
