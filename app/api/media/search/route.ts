import { NextRequest, NextResponse } from 'next/server'
import { searchBooks, searchMovies, searchTVShows } from '@/lib/services/externalMediaService'
import { MediaItem, MediaType } from '@/types/database'
import { adminDb } from '@/lib/firebase-admin'
import { rateLimit, getClientIP } from '@/lib/rate-limit'
import { MediaSearchQuerySchema } from '@/lib/validation/schemas'

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000'

export async function GET(request: NextRequest) {
  const ip = getClientIP(request)
  const { allowed, retryAfter } = rateLimit(ip, 'search')
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const parsed = MediaSearchQuerySchema.safeParse({
    q: searchParams.get('q'),
    type: searchParams.get('type') || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const { q: searchQuery, type } = parsed.data

  try {
    // Run keyword search (TMDB/Google Books) and semantic search (ML service) in parallel
    const keywordPromise = (async () => {
      switch (type) {
        case 'movie': return searchMovies(searchQuery)
        case 'tv': return searchTVShows(searchQuery)
        case 'book': return searchBooks(searchQuery)
        default: {
          const [movies, tvShows, books] = await Promise.all([
            searchMovies(searchQuery),
            searchTVShows(searchQuery),
            searchBooks(searchQuery),
          ])
          return [...movies, ...tvShows, ...books]
        }
      }
    })()

    const semanticPromise = (async (): Promise<MediaItem[]> => {
      try {
        const res = await fetch(`${ML_SERVICE_URL}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchQuery,
            top_k: 5,
            media_type: type || null,
          }),
        })
        if (!res.ok) return []
        const data = await res.json()
        // Semantic results have media_id like "movie-550" — convert to basic MediaItem
        return (data.recommendations || []).map((r: { media_id: string; title: string; media_type: string; score: number }) => ({
          id: r.media_id,
          type: r.media_type as MediaType,
          title: r.title,
          description: `Semantic match (${(r.score * 100).toFixed(0)}% relevant)`,
          externalId: r.media_id.split('-').slice(1).join('-'),
          isSemanticMatch: true,
        }))
      } catch {
        return [] // ML service down — graceful fallback
      }
    })()

    const [keywordResults, semanticResults] = await Promise.all([keywordPromise, semanticPromise])

    // Merge: keyword results first, then semantic results that aren't duplicates
    const seenTitles = new Set(keywordResults.map(r => r.title.toLowerCase()))
    const uniqueSemantic = semanticResults.filter(r => !seenTitles.has(r.title.toLowerCase()))

    const results = [...keywordResults, ...uniqueSemantic]

    return NextResponse.json(results)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Failed to search media' }, { status: 500 })
  }
}
