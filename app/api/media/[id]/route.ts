import { NextResponse } from 'next/server'
import { getMediaWithCache } from '@/lib/services/mediaCache'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Parse media ID format: "movie-550" or "book-abc123" or just "550".
    // When the type prefix is missing we don't know which TMDB endpoint to hit,
    // so try movie → tv → book in order until one resolves.
    if (id.includes('-')) {
      const parts = id.split('-')
      const mediaType = parts[0]
      const externalId = parts.slice(1).join('-')
      const item = await getMediaWithCache(id, mediaType, externalId)
      if (item) return NextResponse.json(item)
      return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    }

    for (const mediaType of ['movie', 'tv', 'book'] as const) {
      const item = await getMediaWithCache(`${mediaType}-${id}`, mediaType, id)
      if (item) return NextResponse.json(item)
    }
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  } catch (error) {
    console.error('Error fetching media:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
