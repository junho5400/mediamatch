import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

// One-shot rebuild of media aggregate stats from user library entries.
// Dev-only: refuses to run in production.
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Forbidden in production' }, { status: 403 })
  }

  const mediaTypes = ['movie', 'tv', 'book'] as const
  // docId -> { distribution: {ratingKey: count} }
  const aggregates = new Map<string, Record<string, number>>()

  const usersSnap = await adminDb.collection('users').get()

  for (const userDoc of usersSnap.docs) {
    for (const type of mediaTypes) {
      const entriesSnap = await adminDb
        .collection('users').doc(userDoc.id)
        .collection('library').doc(type)
        .collection('entries').get()

      for (const entryDoc of entriesSnap.docs) {
        const entry = entryDoc.data()
        const rating = entry.rating
        const mediaId = entry.mediaId
        if (!rating || !mediaId) continue
        const docId = `${type}-${mediaId}`
        const dist = aggregates.get(docId) ?? {}
        const key = Number(rating).toFixed(1)
        dist[key] = (dist[key] || 0) + 1
        aggregates.set(docId, dist)
      }
    }
  }

  let written = 0
  for (const [docId, distribution] of aggregates.entries()) {
    const totalRatings = Object.values(distribution).reduce((a, b) => a + b, 0)
    const weightedSum = Object.entries(distribution)
      .reduce((sum, [r, c]) => sum + parseFloat(r) * c, 0)
    const averageRating = totalRatings > 0 ? weightedSum / totalRatings : 0

    await adminDb.collection('media').doc(docId).set({
      stats: { totalRatings, averageRating, ratingDistribution: distribution },
    }, { merge: true })
    written++
  }

  return NextResponse.json({
    users: usersSnap.size,
    mediaDocsUpdated: written,
  })
}
