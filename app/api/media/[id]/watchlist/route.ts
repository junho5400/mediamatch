import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { verifyAuth, AuthError } from '@/lib/auth/verifyAuth'
import { WatchlistRequestSchema } from '@/lib/validation/schemas'
import { FieldValue } from 'firebase-admin/firestore'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string
  try {
    const auth = await verifyAuth(request)
    userId = auth.userId
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const parsed = WatchlistRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { add } = parsed.data

    // Get media type from Firestore
    const mediaDoc = await adminDb.collection('media').doc(id).get()
    const mediaType = mediaDoc.exists ? (mediaDoc.data()?.type || 'movie') : 'movie'
    const fullMediaId = `${mediaType}-${id}`

    const userRef = adminDb.collection('users').doc(userId)
    const userDoc = await userRef.get()

    if (!userDoc.exists) {
      await userRef.set({
        watchlist: add ? [fullMediaId] : [],
        updatedAt: new Date(),
      })
    } else {
      await userRef.update({
        watchlist: add
          ? FieldValue.arrayUnion(fullMediaId)
          : FieldValue.arrayRemove(fullMediaId),
        updatedAt: new Date(),
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating watchlist:', error)
    return NextResponse.json({ error: 'Failed to update watchlist' }, { status: 500 })
  }
}
