import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Resolve the real doc id: media docs are stored with a `${type}-${id}` key.
    // The URL passes only the bare id, so try each type prefix in turn.
    const candidateIds = id.includes('-')
      ? [id]
      : [`movie-${id}`, `tv-${id}`, `book-${id}`]

    let mediaDoc = null
    for (const docId of candidateIds) {
      const snap = await adminDb.collection('media').doc(docId).get()
      if (snap.exists) { mediaDoc = snap; break }
    }

    if (mediaDoc) {
      const data = mediaDoc.data()
      const stats = data?.stats
      if (stats?.ratingDistribution) {
        return NextResponse.json({
          distribution: stats.ratingDistribution,
          totalRatings: stats.totalRatings || 0,
        })
      }
    }

    // No data found — return empty distribution
    return NextResponse.json({
      distribution: {},
      totalRatings: 0,
    })
  } catch (error) {
    console.error('Error fetching rating distribution:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rating distribution' },
      { status: 500 }
    )
  }
}
