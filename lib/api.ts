import {
  addMediaEntry,
  getUserProfile as getUserProfileFromFirestore,
} from '@/lib/firebase/firestore'
import { auth } from '@/lib/firebase/firebase'
import { MediaEntry, MediaType, UserProfile } from '@/types/database'

export async function addMediaToLibrary(mediaData: {
  mediaId: string
  date?: Date
  tags?: string
  notes?: string
  rating?: number
  title?: string
  coverImage?: string
}) {
  const user = auth.currentUser
  if (!user) throw new Error('User must be logged in to add media to library')

  let mediaDetails = null
  try {
    const response = await fetch(`/api/media/${mediaData.mediaId}`)
    if (response.ok) {
      mediaDetails = await response.json()
    }
  } catch {
    // Media details are optional, continue with provided data
  }

  const title = mediaData.title || mediaDetails?.title || 'Unknown Title'
  const coverImage = mediaData.coverImage || mediaDetails?.coverImage || '/placeholder.svg'
  const type = mediaDetails?.type || ('movie' as MediaType)

  const entry: Omit<MediaEntry, 'createdAt' | 'updatedAt'> = {
    rating: mediaData.rating || 0,
    tag: mediaData.tags,
    review: mediaData.notes,
    watchedAt: mediaData.date || new Date(),
    title,
    coverImage,
    mediaId: mediaData.mediaId,
    type,
  }

  const entryId = await addMediaEntry(user.uid, type, mediaData.mediaId, entry)

  // Remove from watchlist after logging
  try {
    const token = await user.getIdToken()
    await fetch(`/api/media/${mediaData.mediaId}/watchlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ add: false }),
    })
  } catch {
    // Watchlist removal is best-effort
  }

  return entryId
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const userDoc = await getUserProfileFromFirestore(uid)
  return userDoc || null
}
