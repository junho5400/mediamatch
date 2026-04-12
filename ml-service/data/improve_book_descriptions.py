"""Replace Google Books meta-descriptions with Wikipedia plot summaries.

For each book in our catalog:
1. Search Wikipedia for the book title
2. Try to extract the "Plot" or "Synopsis" section
3. If no plot section, use the Wikipedia intro (still better than Google Books)
4. If Wikipedia has nothing, keep the original Google Books description

Usage:
    python -m data.improve_book_descriptions
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


def search_wikipedia(title: str, author: str | None = None) -> str | None:
    """Search Wikipedia for a book and return the page title."""
    # Try exact title first, then title + "novel"
    queries = [title, f"{title} (novel)", f"{title} (book)"]
    if author:
        queries.append(f"{title} {author}")

    for query in queries:
        params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": 3,
            "format": "json",
        }
        try:
            resp = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=10)
            results = resp.json().get("query", {}).get("search", [])
            for r in results:
                page_title = r.get("title", "")
                # Basic relevance check — page title should contain our book title
                if title.lower().split(":")[0].strip() in page_title.lower():
                    return page_title
        except Exception:
            continue

    return None


def get_plot_section(page_title: str) -> str | None:
    """Extract the Plot/Synopsis section from a Wikipedia page."""
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "sections",
        "format": "json",
    }
    try:
        resp = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=10)
        sections = resp.json().get("parse", {}).get("sections", [])

        plot_idx = None
        for s in sections:
            line = s.get("line", "").lower()
            if line in ("plot", "plot summary", "synopsis", "summary", "premise",
                        "plot synopsis", "storyline", "narrative"):
                plot_idx = s.get("index")
                break

        if plot_idx is None:
            return None

        # Fetch the section text
        params2 = {
            "action": "parse",
            "page": page_title,
            "prop": "wikitext",
            "section": plot_idx,
            "format": "json",
        }
        resp2 = requests.get(WIKI_API, params=params2, headers=HEADERS, timeout=10)
        wikitext = resp2.json().get("parse", {}).get("wikitext", {}).get("*", "")

        return clean_wikitext(wikitext)
    except Exception:
        return None


def get_intro(page_title: str) -> str | None:
    """Get the Wikipedia intro paragraph as fallback."""
    params = {
        "action": "query",
        "titles": page_title,
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "format": "json",
    }
    try:
        resp = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=10)
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            extract = page.get("extract", "")
            if extract and len(extract) > 50:
                return extract[:500]
    except Exception:
        pass
    return None


def clean_wikitext(text: str) -> str:
    """Strip Wikipedia markup to get plain text."""
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text)  # [[link|text]] -> text
    text = re.sub(r"\{\{[^}]*\}\}", "", text)  # Remove templates
    text = re.sub(r"<[^>]+>", "", text)  # Remove HTML
    text = re.sub(r"==+[^=]+=+", "", text)  # Remove headers
    text = re.sub(r"'''?", "", text)  # Remove bold/italic
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"\n+", " ", text).strip()
    text = re.sub(r"\s+", " ", text)
    # Truncate to reasonable length
    return text[:600] if text else ""


def main():
    catalog = pd.read_parquet(os.path.join(settings.PROCESSED_DIR, "media_catalog.parquet"))
    books = catalog[catalog["media_type"] == "book"].copy()
    print(f"Processing {len(books)} books...")

    # Load existing descriptions
    with open(os.path.join(settings.DATA_DIR, "books_media.json")) as f:
        books_raw = json.load(f)
    original_descs = {b["id"]: b["description"] for b in books_raw}

    improved = {}  # book_id -> new description
    stats = {"plot_section": 0, "intro": 0, "kept_original": 0, "no_wiki": 0}

    for _, row in tqdm(books.iterrows(), total=len(books), desc="Improving descriptions"):
        book_id = row["id"]
        title = row["title"]
        authors = row.get("authors")
        author = authors[0] if isinstance(authors, list) and authors else None
        original = original_descs.get(book_id, "")

        # Search Wikipedia
        wiki_page = search_wikipedia(title, author)

        if wiki_page:
            # Try plot section first
            plot = get_plot_section(wiki_page)
            if plot and len(plot) > 50:
                improved[book_id] = plot
                stats["plot_section"] += 1
            else:
                # Fall back to intro
                intro = get_intro(wiki_page)
                if intro and len(intro) > len(original) * 0.5:
                    improved[book_id] = intro
                    stats["intro"] += 1
                else:
                    stats["kept_original"] += 1
        else:
            stats["no_wiki"] += 1

        time.sleep(0.1)  # Be nice to Wikipedia

    print(f"\n=== Results ===")
    print(f"  Plot sections found: {stats['plot_section']}")
    print(f"  Wiki intros used: {stats['intro']}")
    print(f"  Kept original: {stats['kept_original']}")
    print(f"  Not found on Wikipedia: {stats['no_wiki']}")
    print(f"  Total improved: {stats['plot_section'] + stats['intro']}")

    # Save
    output_path = os.path.join(settings.PROCESSED_DIR, "book_descriptions_improved.json")
    with open(output_path, "w") as f:
        json.dump(improved, f, indent=2)
    print(f"\nSaved {len(improved)} improved descriptions to {output_path}")


if __name__ == "__main__":
    main()
