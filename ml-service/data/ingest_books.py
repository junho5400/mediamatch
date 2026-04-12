"""Pull books from Google Books API and save as MediaDocuments.

Google Books doesn't have a "popular" list endpoint, so we search by
well-known categories/subjects to build a diverse catalog.

Usage:
    python -m data.ingest_books
"""

import json
import os
import time

import requests
from tqdm import tqdm

from config import settings
from data.schema import MediaDocument

GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes"

# Search queries to build a diverse book catalog
SEARCH_QUERIES = [
    # Core genres
    "subject:fiction", "subject:mystery", "subject:science fiction",
    "subject:fantasy", "subject:romance", "subject:thriller",
    "subject:horror", "subject:biography", "subject:history",
    "subject:science", "subject:philosophy", "subject:psychology",
    "subject:self-help", "subject:business", "subject:poetry",
    "subject:adventure", "subject:young adult", "subject:literary fiction",
    "subject:true crime", "subject:memoir",
    # Sub-genres and niches
    "subject:dystopian", "subject:historical fiction", "subject:crime fiction",
    "subject:graphic novels", "subject:humor", "subject:travel",
    "subject:cooking", "subject:art", "subject:music", "subject:sports",
    "subject:politics", "subject:economics", "subject:technology",
    "subject:nature", "subject:religion", "subject:education",
    "subject:health", "subject:parenting", "subject:comics",
    "subject:drama", "subject:espionage", "subject:mythology",
    "subject:sociology", "subject:anthropology", "subject:astronomy",
    # Popular/notable
    "bestseller fiction", "award winning novels",
    "classic literature", "contemporary fiction",
    "popular nonfiction", "new york times bestseller",
    "pulitzer prize fiction", "booker prize", "hugo award winner",
    "national book award", "nobel prize literature",
    "oprah book club", "goodreads choice awards",
    # Era-based
    "best novels 2020s", "best novels 2010s", "best novels 2000s",
    "best novels 1990s", "best novels 20th century",
    "modern classics fiction", "postmodern literature",
    # Audience
    "popular teen fiction", "children's bestsellers",
    "college reading list", "book club picks",
]

MAX_RESULTS_PER_QUERY = 40  # Google Books max per request


def fetch_books_for_query(query: str, start_index: int = 0) -> list[dict]:
    """Fetch a batch of books for a single query."""
    params = {
        "q": query,
        "key": settings.GOOGLE_BOOKS_API_KEY,
        "maxResults": MAX_RESULTS_PER_QUERY,
        "startIndex": start_index,
        "printType": "books",
        "langRestrict": "en",
    }
    resp = requests.get(GOOGLE_BOOKS_API, params=params, timeout=10)
    if resp.status_code != 200:
        return []
    data = resp.json()
    return data.get("items", [])


def parse_book(item: dict) -> MediaDocument | None:
    """Parse a Google Books API item into a MediaDocument."""
    info = item.get("volumeInfo", {})
    title = info.get("title", "")
    description = info.get("description", "")

    # Skip books without title or description
    if not title or not description:
        return None

    cover = None
    image_links = info.get("imageLinks", {})
    if image_links:
        # Prefer larger images, fall back to thumbnail
        cover = image_links.get("thumbnail") or image_links.get("smallThumbnail")

    year_str = info.get("publishedDate", "")[:4] or None

    return MediaDocument(
        id=f"book-{item['id']}",
        external_id=item["id"],
        media_type="book",
        title=title,
        description=description,
        genres=info.get("categories", []),
        year=year_str,
        cover_image=cover,
        rating=info.get("averageRating", 0),
        total_ratings=info.get("ratingsCount", 0),
        authors=info.get("authors"),
        source="google_books",
    )


def main():
    os.makedirs(settings.DATA_DIR, exist_ok=True)

    seen_ids: set[str] = set()
    all_books: list[MediaDocument] = []

    for query in tqdm(SEARCH_QUERIES, desc="Book queries"):
        # Fetch 4 pages per query (160 results max)
        for start in [0, 40, 80, 120]:
            items = fetch_books_for_query(query, start_index=start)
            if not items:
                break  # No more results for this query
            for item in items:
                book_id = item.get("id", "")
                if book_id in seen_ids:
                    continue
                seen_ids.add(book_id)

                doc = parse_book(item)
                if doc:
                    all_books.append(doc)

            time.sleep(0.15)  # Respect rate limits

    print(f"\n{len(all_books)} unique books with descriptions")

    output_path = os.path.join(settings.DATA_DIR, "books_media.json")
    with open(output_path, "w") as f:
        json.dump([doc.model_dump() for doc in all_books], f, indent=2)

    print(f"Saved to {output_path}")


if __name__ == "__main__":
    main()
