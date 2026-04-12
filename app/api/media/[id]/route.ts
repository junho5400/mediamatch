import { NextResponse } from 'next/server'
import { getMediaWithCache } from '@/lib/services/mediaCache'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Parse media ID format: "movie-550" or "book-abc123" or just "550"
    let mediaType = 'movie'
    let externalId = id

    if (id.includes('-')) {
      const parts = id.split('-')
      mediaType = parts[0]
      externalId = parts.slice(1).join('-')  // Handle book IDs with dashes
    }

    // Shared cache: Firestore first → API fallback → cache result
    const mediaItem = await getMediaWithCache(id, mediaType, externalId)

    if (mediaItem) {
      return NextResponse.json(mediaItem)
    }

    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  } catch (error) {
    console.error('Error fetching media:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
