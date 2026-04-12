"""Replace all media descriptions with Wikipedia intros for consistent embedding quality.

Wikipedia intros capture genre + themes + premise at the right level of abstraction:
  "Dune is a 1965 epic science fiction novel... set on the desert planet Arrakis..."
  "Fight Club is a 1999 film about an insomniac who forms an underground fight club..."

This ensures movies, TV, and books all embed in the same style — solving the
cross-type recommendation gap where description styles differ between sources.

Usage:
    python -m data.improve_descriptions
"""

import json
import os
import re
import time

import pandas as pd
import requests
from tqdm import tqdm

from config import settings

WIKI_API = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "MediaMatch/1.0 (academic research project)"}


def fetch_wiki_intro(title: str, media_type: str, extra: str | None = None) -> str | None:
    """Fetch Wikipedia intro for a media item in a SINGLE API call.

    Batches all candidate page titles into one request using pipe-separated titles.
    Returns the cleaned intro text, or None if no match found.
    """
    candidates = [title]
    if media_type == "movie":
        candidates.append(f"{title} (film)")
        if extra:
            candidates.append(f"{title} ({extra} film)")
    elif media_type == "tv":
        candidates.extend([f"{title} (TV series)", f"{title} (TV show)"])
    elif media_type == "book":
        candidates.extend([f"{title} (novel)", f"{title} (book)"])

    try:
        params = {
            "action": "query",
            "titles": "|".join(candidates),
            "prop": "extracts",
            "exintro": True,
            "explaintext": True,
            "format": "json",
        }
        resp = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return None

        pages = resp.json().get("query", {}).get("pages", {})

        # Media-type keywords that should appear in a valid intro
        type_signals = {
            "movie": ["film", "movie", "directed", "starring", "screenplay", "produced by", "released"],
            "tv": ["television", "tv series", "tv show", "sitcom", "drama series", "premiered", "season", "episodes", "broadcast", "created by"],
            "book": ["novel", "book", "written by", "author", "published", "memoir", "fiction", "nonfiction"],
        }
        signals = type_signals.get(media_type, [])

        # Find the best match that's actually about the right media type
        best = None
        best_len = 0
        for page in pages.values():
            if page.get("missing") is not None:
                continue
            extract = page.get("extract", "")
            if len(extract) < 80:
                continue

            # Check if intro mentions media-relevant terms
            lower = extract[:500].lower()

            # Skip disambiguation pages
            if "may refer to" in lower or "can refer to" in lower or "is a list of" in lower:
                continue

            has_signal = any(s in lower for s in signals)
            # For the exact title match (first candidate), be more lenient
            is_exact = page.get("title", "").lower() == title.lower()

            if has_signal and len(extract) > best_len:
                best = extract
                best_len = len(extract)
            elif is_exact and len(extract) > best_len and not any(x in lower for x in ["may refer to", "is a list of", "is a type of", "is an architectural"]):
                best = extract
                best_len = len(extract)

        if best and best_len > 80:
            return clean_intro(best)
    except Exception:
        pass

    return None


def clean_intro(text: str) -> str:
    """Clean Wikipedia intro to keep the most descriptive part."""
    # Remove pronunciation guides: ( /ˈdʒuːn/ ) or ( JOON )
    text = re.sub(r"\([^)]*[/ˈ][^)]*\)", "", text)
    text = re.sub(r"\(\s*\)", "", text)

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()

    # Take first ~500 chars (usually 2-3 sentences of intro)
    if len(text) > 500:
        # Try to cut at sentence boundary
        cutoff = text[:500].rfind(". ")
        if cutoff > 200:
            text = text[:cutoff + 1]
        else:
            text = text[:500]

    return text


def main():
    catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
    output_path = os.path.join(settings.PROCESSED_DIR, "descriptions_improved.json")

    # Load existing progress (incremental)
    improved = {}
    if os.path.exists(output_path):
        with open(output_path) as f:
            improved = json.load(f)
        print(f"Loaded {len(improved)} existing descriptions, resuming...")

    # Skip already-processed items
    remaining = catalog[~catalog["id"].isin(improved.keys())]
    print(f"Processing {len(remaining)} remaining items (of {len(catalog)} total)...")

    stats = {"found": 0, "not_found": 0, "too_short": 0, "rate_limited": 0}
    type_stats = {"movie": 0, "tv": 0, "book": 0}

    for i, (_, row) in enumerate(tqdm(remaining.iterrows(), total=len(remaining), desc="Wikipedia lookup")):
        media_id = row["id"]
        title = row["title"]
        media_type = row["media_type"]

        # Extra search context
        extra = None
        if isinstance(row.get("authors"), list) and row["authors"]:
            extra = row["authors"][0]
        elif row.get("year"):
            extra = str(row["year"])

        # Fetch intro in a single API call (all title candidates batched)
        intro = fetch_wiki_intro(title, media_type, extra)

        if intro:
            improved[media_id] = intro
            stats["found"] += 1
            type_stats[media_type] = type_stats.get(media_type, 0) + 1
        else:
            stats["not_found"] += 1

        time.sleep(1.0)  # 1 request per second — very conservative

        # Save progress every 100 items
        if (i + 1) % 100 == 0:
            with open(output_path, "w") as f:
                json.dump(improved, f, indent=2)
            print(f"  Saved checkpoint: {len(improved)} descriptions")

        # Pause every 500 items to avoid rate limit
        if (i + 1) % 500 == 0:
            print(f"  Pausing 60s to avoid rate limit...")
            time.sleep(60)

    print(f"\n=== Results ===")
    print(f"  Wikipedia descriptions found: {stats['found']} ({stats['found']/len(catalog)*100:.0f}%)")
    print(f"  Not found: {stats['not_found']}")
    print(f"  Too short: {stats['too_short']}")
    print(f"\n  By type:")
    for mtype, count in type_stats.items():
        total = len(catalog[catalog["media_type"] == mtype])
        print(f"    {mtype}: {count}/{total} ({count/total*100:.0f}%)")

    # Save
    output_path = os.path.join(settings.PROCESSED_DIR, "descriptions_improved.json")
    with open(output_path, "w") as f:
        json.dump(improved, f, indent=2)
    print(f"\nSaved {len(improved)} improved descriptions to {output_path}")


if __name__ == "__main__":
    main()
