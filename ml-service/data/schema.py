"""Unified media document schema used across the entire ML pipeline."""

import re

from pydantic import BaseModel


class MediaDocument(BaseModel):
    """A single media item (movie, TV show, or book) with all metadata needed for ML.

    This is the canonical representation used by:
    - The ingestion pipeline (TMDB / Google Books -> MediaDocument)
    - The embedding engine (MediaDocument.embedding_text -> vector)
    - The recommendation models (features derived from these fields)
    """

    id: str  # "{type}-{external_id}" e.g. "movie-550", "book-abc123"
    external_id: str  # Original ID from source API
    media_type: str  # "movie", "tv", "book"
    title: str
    description: str  # Overview/synopsis — main text for embedding
    genres: list[str]
    year: str | None = None
    cover_image: str | None = None
    rating: float = 0.0  # Source platform rating (TMDB vote_average, Google Books avg)
    total_ratings: int = 0
    authors: list[str] | None = None  # Books only
    source: str = ""  # "tmdb" or "google_books"

    @staticmethod
    def _clean_book_description(desc: str) -> str:
        """Strip marketing copy and meta-text from book descriptions.

        Google Books descriptions often start with awards, review quotes,
        or publisher copy before the actual plot summary. This noise makes
        book embeddings cluster by marketing style rather than content.
        """
        # Remove leading review quotes: "blah blah" —Reviewer
        # Only strip if there's actual content after the quote
        cleaned = re.sub(r'^[""\u201c][^""\u201d]*[""\u201d]\s*[—–\-][^\n•]*[•\n]\s*', '', desc).strip()
        if len(cleaned) > 30:
            desc = cleaned

        # Remove bullet/dot separated award strings at the start
        # e.g. "PULITZER PRIZE FINALIST • NATIONAL BESTSELLER •"
        desc = re.sub(r'^([A-Z][A-Z\s#]+[•·\|][\s]*)+', '', desc).strip()

        # Remove remaining award/marketing prefixes
        while True:
            new_desc = re.sub(
                r'^(PULITZER|NATIONAL|NEW YORK TIMES|WINNER|AWARD|BESTSELLER|'
                r'#1|NOW A|FROM THE|THE BELOVED|AN INSTANT|A REESE|SOON TO BE|'
                r'A PENGUIN|OPRAH|AMAZON|FINALIST|PRIZE|LONGLISTED|SHORTLISTED)[^.•]*[.•]\s*',
                '', desc, flags=re.IGNORECASE
            ).strip()
            if new_desc == desc:
                break
            desc = new_desc

        # Remove "A Novel", "A Memoir" etc. labels
        desc = re.sub(r'^A (Novel|Memoir|Thriller|Mystery|Romance)[.\s]*', '', desc, flags=re.IGNORECASE).strip()

        return desc

    @property
    def embedding_text(self) -> str:
        """Text representation used for generating embeddings.

        Combines title, genres, and description. These carry semantic meaning
        about the content. We deliberately exclude ratings, year, media type,
        and author names — those are useful as structured features for ranking
        but would pollute the semantic embedding space.

        Book descriptions are cleaned to remove marketing copy so they
        embed by content, not by publisher style.
        """
        genre_str = ", ".join(self.genres) if self.genres else ""
        parts = [self.title]
        if genre_str:
            parts.append(f"({genre_str})")
        if self.description:
            desc = self.description
            if self.media_type == "book":
                desc = self._clean_book_description(desc)
            parts.append(f"- {desc[:500]}")
        return " ".join(parts)
