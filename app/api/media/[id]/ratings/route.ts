import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Query actual rating distribution from media document
    const mediaDoc = await adminDb.collection('media').doc(id).get()

    if (mediaDoc.exists) {
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
