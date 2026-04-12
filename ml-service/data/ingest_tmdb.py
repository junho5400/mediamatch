"""Pull movies and TV shows from TMDB and save as MediaDocuments.

Uses the 'popular' and 'top_rated' endpoints with pagination.
TMDB allows ~40 requests/sec, so we add a small delay to be safe.

Usage:
    python -m data.ingest_tmdb
"""

import json
import os
import time

import requests
from tqdm import tqdm

from config import settings
from data.schema import MediaDocument

TMDB_API = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
    80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
    14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
    9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
    10759: "Action & Adventure", 10762: "Kids", 10763: "News",
    10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
    10767: "Talk", 10768: "War & Politics",
}

# Movie genre IDs for discover endpoint
MOVIE_GENRE_IDS = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37]
# TV genre IDs for discover endpoint
TV_GENRE_IDS = [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10764, 10765, 10766, 10767, 10768, 37]


def fetch_tmdb_pages(endpoint: str, max_pages: int = 50) -> list[dict]:
    """Fetch multiple pages from a TMDB list endpoint."""
    results = []
    for page in tqdm(range(1, max_pages + 1), desc=f"TMDB {endpoint}"):
        url = f"{TMDB_API}/{endpoint}?api_key={settings.TMDB_API_KEY}&page={page}"
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            print(f"  Stopping at page {page}: HTTP {resp.status_code}")
            break
        data = resp.json()
        results.extend(data.get("results", []))
        if page >= data.get("total_pages", 0):
            break
        time.sleep(0.05)  # Stay well under rate limit
    return results


def parse_movie(item: dict) -> MediaDocument:
    return MediaDocument(
        id=f"movie-{item['id']}",
        external_id=str(item["id"]),
        media_type="movie",
        title=item.get("title", ""),
        description=item.get("overview", ""),
        genres=[GENRE_MAP.get(gid, "Unknown") for gid in item.get("genre_ids", [])],
        year=item.get("release_date", "")[:4] or None,
        cover_image=f"{TMDB_IMAGE_BASE}{item['poster_path']}" if item.get("poster_path") else None,
        rating=item.get("vote_average", 0),
        total_ratings=item.get("vote_count", 0),
        source="tmdb",
    )


def parse_tv(item: dict) -> MediaDocument:
    return MediaDocument(
        id=f"tv-{item['id']}",
        external_id=str(item["id"]),
        media_type="tv",
        title=item.get("name", ""),
        description=item.get("overview", ""),
        genres=[GENRE_MAP.get(gid, "Unknown") for gid in item.get("genre_ids", [])],
        year=item.get("first_air_date", "")[:4] or None,
        cover_image=f"{TMDB_IMAGE_BASE}{item['poster_path']}" if item.get("poster_path") else None,
        rating=item.get("vote_average", 0),
        total_ratings=item.get("vote_count", 0),
        source="tmdb",
    )


def fetch_discover_pages(media_type: str, genre_id: int, max_pages: int = 15) -> list[dict]:
    """Fetch from TMDB discover endpoint filtered by genre.

    The discover endpoint returns different results than popular/top_rated,
    giving us broader coverage of the catalog.
    """
    results = []
    endpoint = f"discover/{media_type}"
    for page in range(1, max_pages + 1):
        url = (
            f"{TMDB_API}/{endpoint}?api_key={settings.TMDB_API_KEY}"
            f"&page={page}&with_genres={genre_id}"
            f"&sort_by=vote_count.desc&vote_count.gte=50"
        )
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            break
        data = resp.json()
        results.extend(data.get("results", []))
        if page >= data.get("total_pages", 0):
            break
        time.sleep(0.05)
    return results


def main():
    os.makedirs(settings.DATA_DIR, exist_ok=True)

    # --- Movies ---
    print("=== Fetching Movies ===")
    movies_raw = []

    # List endpoints (popular + top_rated)
    for endpoint in ["movie/popular", "movie/top_rated"]:
        movies_raw.extend(fetch_tmdb_pages(endpoint, max_pages=50))

    # Discover by genre — picks up items not in the popular/top_rated lists
    print("  Discovering movies by genre...")
    for gid in tqdm(MOVIE_GENRE_IDS, desc="Movie genres"):
        movies_raw.extend(fetch_discover_pages("movie", gid, max_pages=15))

    # Deduplicate by ID
    seen = set()
    movies = []
    for item in movies_raw:
        if item["id"] not in seen:
            seen.add(item["id"])
            doc = parse_movie(item)
            if doc.description:
                movies.append(doc)

    print(f"  {len(movies)} unique movies with descriptions")

    # --- TV Shows ---
    print("\n=== Fetching TV Shows ===")
    tv_raw = []

    for endpoint in ["tv/popular", "tv/top_rated"]:
        tv_raw.extend(fetch_tmdb_pages(endpoint, max_pages=50))

    print("  Discovering TV shows by genre...")
    for gid in tqdm(TV_GENRE_IDS, desc="TV genres"):
        tv_raw.extend(fetch_discover_pages("tv", gid, max_pages=15))

    seen = set()
    tv_shows = []
    for item in tv_raw:
        if item["id"] not in seen:
            seen.add(item["id"])
            doc = parse_tv(item)
            if doc.description:
                tv_shows.append(doc)

    print(f"  {len(tv_shows)} unique TV shows with descriptions")

    # --- Save ---
    all_media = movies + tv_shows
    output_path = os.path.join(settings.DATA_DIR, "tmdb_media.json")
    with open(output_path, "w") as f:
        json.dump([doc.model_dump() for doc in all_media], f, indent=2)

    print(f"\nSaved {len(all_media)} total items to {output_path}")


if __name__ == "__main__":
    main()
