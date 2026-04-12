/**
 * Shared media metadata fetcher with Firestore caching.
 *
 * Used by both the media detail page and recommendation enrichment.
 * Flow: Firestore cache → TMDB/Google Books API → cache result in Firestore
 *
 * This eliminates redundant API calls — once a media item is fetched,
 * it's stored in Firestore and never fetched again.
 */

import { adminDb } from "@/lib/firebase-admin"
import { MediaItem, MediaType } from "@/types/database"

const TMDB_API = "https://api.themoviedb.org/3"
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY
const BOOKS_KEY = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY || process.env.GOOGLE_BOOKS_API_KEY
const OPEN_LIBRARY_API = "https://openlibrary.org"
const OPEN_LIBRARY_COVERS = "https://covers.openlibrary.org"

/**
 * Fetch book data from Open Library — free, no API key, better covers.
 * Searches by title since our externalId is a Google Books ID.
 */
async function fetchBookFromOpenLibrary(externalId: string): Promise<MediaItem | null> {
  try {
    // First try to get the book from Google Books to get the title for OL search
    // (we need the title to search Open Library since OL doesn't know Google Books IDs)
    const gbResp = await fetch(`https://www.googleapis.com/books/v1/volumes/${externalId}?key=${BOOKS_KEY}`)
    if (!gbResp.ok) return null
    const gbData = await gbResp.json()
    const title = gbData.volumeInfo?.title
    const authors = gbData.volumeInfo?.authors
    if (!title) return null

    // Search Open Library by title
    const query = authors ? `${title} ${authors[0]}` : title
    const searchResp = await fetch(
      `${OPEN_LIBRARY_API}/search.json?q=${encodeURIComponent(query)}&limit=3`,
      { headers: { "User-Agent": "MediaMatch/1.0 (academic project)" } }
    )
    if (!searchResp.ok) return null
    const searchData = await searchResp.json()
    const doc = searchData.docs?.[0]
    if (!doc) return null

    // Get cover image — Open Library has multiple sizes
    const coverId = doc.cover_i
    const coverImage = coverId
      ? `${OPEN_LIBRARY_COVERS}/b/id/${coverId}-L.jpg`
      : gbData.volumeInfo?.imageLinks?.thumbnail  // Fall back to Google Books thumbnail

    // Get description from the work
    let description = ""
    const workKey = doc.key
    if (workKey) {
      try {
        const workResp = await fetch(`${OPEN_LIBRARY_API}${workKey}.json`,
          { headers: { "User-Agent": "MediaMatch/1.0 (academic project)" } }
        )
        if (workResp.ok) {
          const workData = await workResp.json()
          const desc = workData.description
          description = typeof desc === "string" ? desc : desc?.value || ""
        }
      } catch { /* Use empty description */ }
    }

    // Fall back to Google Books description if Open Library has none
    if (!description) {
      description = gbData.volumeInfo?.description || ""
    }

    return {
      id: externalId,
      type: "book" as MediaType,
      title: doc.title || title,
      description,
      coverImage,
      genres: doc.subject?.slice(0, 5) || gbData.volumeInfo?.categories || [],
      year: doc.first_publish_year?.toString() || gbData.volumeInfo?.publishedDate?.substring(0, 4),
      authors: doc.author_name || authors,
      rating: 0,  // We use our own community ratings instead
      totalRatings: 0,
      externalId,
    }
  } catch {
    return null
  }
}

/**
 * Fetch book from Google Books as fallback.
 */
async function fetchBookFromGoogleBooks(externalId: string): Promise<MediaItem | null> {
  try {
    const resp = await fetch(`https://www.googleapis.com/books/v1/volumes/${externalId}?key=${BOOKS_KEY}`)
    if (!resp.ok) return null
    const data = await resp.json()
    const info = data.volumeInfo || {}
    return {
      id: externalId,
      type: "book" as MediaType,
      title: info.title || "",
      description: info.description || "",
      coverImage: info.imageLinks?.thumbnail,
      genres: info.categories || [],
      year: info.publishedDate?.substring(0, 4),
      authors: info.authors,
      rating: 0,
      totalRatings: 0,
      externalId,
    }
  } catch {
    return null
  }
}

/**
 * Get media metadata, checking Firestore cache first.
 * If not cached, fetches from external API and caches the result.
 */
export async function getMediaWithCache(
  mediaId: string,
  mediaType: string,
  externalId: string
): Promise<MediaItem | null> {
  // Check Firestore cache first
  const docId = `${mediaType}-${externalId}`
  try {
    const cached = await adminDb.collection("media").doc(docId).get()
    if (cached.exists) {
      const data = cached.data()!
      let backdropImage = data.backdropImage

      // Backfill backdrop if missing (for items cached before we added this field)
      if (!backdropImage && (mediaType === "movie" || mediaType === "tv")) {
        try {
          const endpoint = mediaType === "movie" ? "movie" : "tv"
          const resp = await fetch(`${TMDB_API}/${endpoint}/${externalId}?api_key=${TMDB_KEY}`)
          if (resp.ok) {
            const tmdb = await resp.json()
            if (tmdb.backdrop_path) {
              backdropImage = `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}`
              // Update cache with backdrop
              await adminDb.collection("media").doc(docId).update({ backdropImage })
            }
          }
        } catch {}
      }

      return {
        id: externalId,
        type: data.type || mediaType as MediaType,
        title: data.title,
        description: data.description || data.overview || "",
        coverImage: data.coverImage,
        backdropImage,
        genres: data.genres || [],
        year: data.year || data.releaseDate?.substring(0, 4),
        releaseDate: data.releaseDate,
        rating: data.rating,
        totalRatings: data.totalRatings,
        authors: data.authors,
        externalId,
      }
    }
  } catch {
    // Firestore miss — continue to API
  }

  // Fetch from external API
  let item: MediaItem | null = null

  try {
    if (mediaType === "movie" || mediaType === "tv") {
      const endpoint = mediaType === "movie" ? "movie" : "tv"
      const resp = await fetch(`${TMDB_API}/${endpoint}/${externalId}?api_key=${TMDB_KEY}`)
      if (resp.ok) {
        const data = await resp.json()
        item = {
          id: externalId,
          type: mediaType as MediaType,
          title: mediaType === "movie" ? data.title : data.name,
          description: data.overview || "",
          coverImage: data.poster_path ? `${TMDB_IMAGE_BASE}${data.poster_path}` : undefined,
          backdropImage: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : undefined,
          genres: data.genres?.map((g: { name: string }) => g.name) || [],
          year: (mediaType === "movie" ? data.release_date : data.first_air_date)?.substring(0, 4),
          releaseDate: mediaType === "movie" ? data.release_date : data.first_air_date,
          rating: data.vote_average,
          totalRatings: data.vote_count,
          externalId,
        }
      }
    } else if (mediaType === "book") {
      item = await fetchBookFromOpenLibrary(externalId)
      // Fall back to Google Books if Open Library has nothing
      if (!item) {
        item = await fetchBookFromGoogleBooks(externalId)
      }
    }
  } catch (err) {
    console.error(`API fetch failed for ${docId}:`, err)
  }

  // Cache in Firestore for future use
  if (item) {
    try {
      await adminDb.collection("media").doc(docId).set({
        ...item,
        type: mediaType,
        updatedAt: new Date(),
      })
    } catch {
      // Cache write failure is non-fatal
    }
  }

  return item
}

/**
 * Batch fetch media items with caching.
 * Used by recommendation enrichment to efficiently fetch 20 items.
 */
export async function getMediaBatchWithCache(
  items: Array<{ media_id: string; title: string }>
): Promise<MediaItem[]> {
  const promises = items.map(async (item) => {
    const [mediaType, ...idParts] = item.media_id.split("-")
    const externalId = idParts.join("-")
    return getMediaWithCache(item.media_id, mediaType, externalId)
  })

  const results = await Promise.all(promises)

  return results.filter((item): item is MediaItem =>
    item !== null && !!item.coverImage && !!item.description
  )
}
