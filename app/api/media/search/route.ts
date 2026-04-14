import { NextRequest, NextResponse } from 'next/server'
import { searchBooks, searchMovies, searchTVShows } from '@/lib/services/externalMediaService'
import { getMediaBatchWithCache } from '@/lib/services/mediaCache'
import { MediaItem } from '@/types/database'
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
  const mode = searchParams.get('mode') === 'semantic' ? 'semantic' : 'keyword'

  try {
    if (mode === 'keyword') {
      let results: MediaItem[] = []
      switch (type) {
        case 'movie': results = await searchMovies(searchQuery); break
        case 'tv': results = await searchTVShows(searchQuery); break
        case 'book': results = await searchBooks(searchQuery); break
        default: {
          const [movies, tvShows, books] = await Promise.all([
            searchMovies(searchQuery),
            searchTVShows(searchQuery),
            searchBooks(searchQuery),
          ])
          results = [...movies, ...tvShows, ...books]
        }
      }
      return NextResponse.json(results)
    }

    // Semantic mode: hit the ML service only
    const res = await fetch(`${ML_SERVICE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: searchQuery,
        top_k: 10,
        media_type: type || null,
      }),
    })
    if (!res.ok) return NextResponse.json([])
    const data = await res.json()
    const rawItems = (data.recommendations || []) as Array<{ media_id: string; title: string; media_type: string; score: number }>
    if (rawItems.length === 0) return NextResponse.json([])
    const enriched = await getMediaBatchWithCache(rawItems)
    const scoreById = new Map(rawItems.map(r => [r.media_id, r.score]))
    const results = enriched.map(item => ({
      ...item,
      description: `Semantic match (${((scoreById.get(item.id) ?? 0) * 100).toFixed(0)}% relevant)`,
      isSemanticMatch: true,
    }))
    return NextResponse.json(results)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Failed to search media' }, { status: 500 })
  }
}
