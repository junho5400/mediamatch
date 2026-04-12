import { db } from '@/lib/firebase/firebase'
import { collection, doc, getDoc, setDoc, updateDoc, getDocs, addDoc, deleteDoc, runTransaction } from 'firebase/firestore'
import { MediaEntry, MediaType, UserProfile, MediaItem } from '@/types/database'
import { removeUndefinedFields } from "@/lib/utils"

// User Profile Operations
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const userDoc = await getDoc(doc(db, 'users', userId))
  if (userDoc.exists()) {
    return userDoc.data() as UserProfile
  }
  return null
}

export async function createUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  const userProfile: UserProfile = {
    uid: userId,
    email: data.email || '',
    displayName: data.displayName || '',
    photoURL: data.photoURL,
    createdAt: new Date(),
    updatedAt: new Date(),
    stats: {
      totalRatings: 0,
      averageRating: 0,
      ratingDistribution: {},
    },
  }
  await setDoc(doc(db, 'users', userId), removeUndefinedFields(userProfile))
}

export async function updateUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  }
  await updateDoc(doc(db, 'users', userId), updateData)
}

// Media Entry Operations
export async function addMediaEntry(
  userId: string,
  mediaType: MediaType,
  mediaId: string,
  entry: Omit<MediaEntry, 'createdAt' | 'updatedAt'>
): Promise<string> {
  // Ensure user document exists
  const userRef = doc(db, 'users', userId)
  const userDoc = await getDoc(userRef)

  if (!userDoc.exists()) {
    await createUserProfile(userId, {})
  }

  const entryData: MediaEntry = {
    ...entry,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // Create library document if it doesn't exist
  const libraryRef = doc(db, 'users', userId, 'library', mediaType)
  await setDoc(libraryRef, removeUndefinedFields({
    type: mediaType,
    updatedAt: new Date(),
  }), { merge: true })

  // Add the entry
  const entriesRef = collection(libraryRef, 'entries')
  const entryRef = await addDoc(entriesRef, {
    ...entryData,
    mediaId,
    type: mediaType,
  })

  // Update rating statistics
  if (entry.rating) {
    await updateUserRatingStats(userId, entry.rating)
    await updateMediaRatingStats(mediaType, mediaId, entry.rating)
  }

  return entryRef.id
}

export async function updateMediaEntry(
  userId: string,
  mediaType: MediaType,
  mediaId: string,
  entryId: string,
  oldRating: number,
  entry: Partial<Omit<MediaEntry, 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const updateData = {
    ...entry,
    updatedAt: new Date(),
  }

  const mediaTypeRef = doc(db, 'users', userId, 'library', mediaType)
  await updateDoc(doc(mediaTypeRef, 'entries', entryId), updateData)

  if (entry.rating && entry.rating !== oldRating) {
    await updateUserRatingStats(userId, entry.rating, oldRating)
    await updateMediaRatingStats(mediaType, mediaId, entry.rating, oldRating)
  }
}

export async function deleteMediaEntry(
  userId: string,
  mediaType: MediaType,
  mediaId: string,
  entryId: string,
  rating?: number
): Promise<void> {
  const entryRef = doc(db, 'users', userId, 'library', mediaType, 'entries', entryId)
  await deleteDoc(entryRef)

  // Roll back rating stats if entry had a rating
  if (rating) {
    await rollbackUserRatingStats(userId, rating)
    await rollbackMediaRatingStats(mediaType, mediaId, rating)
  }
}

// Rating statistics helpers
async function updateUserRatingStats(
  userId: string,
  newRating: number,
  oldRating?: number
): Promise<void> {
  const userRef = doc(db, 'users', userId)

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef)
    const userData = userDoc.data() as UserProfile

    const stats = userData.stats || {
      totalRatings: 0,
      averageRating: 0,
      ratingDistribution: {},
    }

    if (oldRating) {
      const oldKey = oldRating.toFixed(1)
      stats.ratingDistribution[oldKey] = (stats.ratingDistribution[oldKey] || 1) - 1
      if (stats.ratingDistribution[oldKey] <= 0) {
        delete stats.ratingDistribution[oldKey]
      }
    } else {
      stats.totalRatings += 1
    }

    const ratingKey = newRating.toFixed(1)
    stats.ratingDistribution[ratingKey] = (stats.ratingDistribution[ratingKey] || 0) + 1

    const totalRatings = Object.values(stats.ratingDistribution).reduce((sum, count) => sum + count, 0)
    const weightedSum = Object.entries(stats.ratingDistribution)
      .reduce((sum, [rating, count]) => sum + (parseFloat(rating) * count), 0)

    stats.averageRating = totalRatings > 0 ? weightedSum / totalRatings : 0
    stats.totalRatings = totalRatings

    transaction.update(userRef, { stats })
  })
}

async function rollbackUserRatingStats(userId: string, rating: number): Promise<void> {
  const userRef = doc(db, 'users', userId)

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef)
    const userData = userDoc.data() as UserProfile

    const stats = userData.stats || { totalRatings: 0, averageRating: 0, ratingDistribution: {} }
    const key = rating.toFixed(1)

    stats.ratingDistribution[key] = (stats.ratingDistribution[key] || 1) - 1
    if (stats.ratingDistribution[key] <= 0) {
      delete stats.ratingDistribution[key]
    }

    const totalRatings = Object.values(stats.ratingDistribution).reduce((sum, count) => sum + count, 0)
    const weightedSum = Object.entries(stats.ratingDistribution)
      .reduce((sum, [r, count]) => sum + (parseFloat(r) * count), 0)

    stats.averageRating = totalRatings > 0 ? weightedSum / totalRatings : 0
    stats.totalRatings = totalRatings

    transaction.update(userRef, { stats })
  })
}

async function updateMediaRatingStats(
  mediaType: MediaType,
  mediaId: string,
  newRating: number,
  oldRating?: number
): Promise<void> {
  const mediaRef = doc(db, 'media', `${mediaType}-${mediaId}`)

  await runTransaction(db, async (transaction) => {
    const mediaDoc = await transaction.get(mediaRef)

    if (!mediaDoc.exists()) {
      const mediaData: MediaItem = {
        id: mediaId,
        type: mediaType,
        title: '',
        stats: {
          totalRatings: 1,
          averageRating: newRating,
          ratingDistribution: { [newRating.toFixed(1)]: 1 },
        },
      }
      transaction.set(mediaRef, removeUndefinedFields(mediaData))
      return
    }

    const mediaData = mediaDoc.data() as MediaItem
    const stats = mediaData.stats || { totalRatings: 0, averageRating: 0, ratingDistribution: {} }

    if (oldRating) {
      const oldKey = oldRating.toFixed(1)
      stats.ratingDistribution[oldKey] = (stats.ratingDistribution[oldKey] || 1) - 1
      if (stats.ratingDistribution[oldKey] <= 0) {
        delete stats.ratingDistribution[oldKey]
      }
    } else {
      stats.totalRatings += 1
    }

    const ratingKey = newRating.toFixed(1)
    stats.ratingDistribution[ratingKey] = (stats.ratingDistribution[ratingKey] || 0) + 1

    const totalRatings = Object.values(stats.ratingDistribution).reduce((sum, count) => sum + count, 0)
    const weightedSum = Object.entries(stats.ratingDistribution)
      .reduce((sum, [rating, count]) => sum + (parseFloat(rating) * count), 0)

    stats.averageRating = totalRatings > 0 ? weightedSum / totalRatings : 0
    stats.totalRatings = totalRatings

    transaction.update(mediaRef, { stats })
  })
}

async function rollbackMediaRatingStats(
  mediaType: MediaType,
  mediaId: string,
  rating: number
): Promise<void> {
  const mediaRef = doc(db, 'media', `${mediaType}-${mediaId}`)

  await runTransaction(db, async (transaction) => {
    const mediaDoc = await transaction.get(mediaRef)

    if (!mediaDoc.exists()) return

    const mediaData = mediaDoc.data() as MediaItem
    const stats = mediaData.stats || { totalRatings: 0, averageRating: 0, ratingDistribution: {} }
    const key = rating.toFixed(1)

    stats.ratingDistribution[key] = (stats.ratingDistribution[key] || 1) - 1
    if (stats.ratingDistribution[key] <= 0) {
      delete stats.ratingDistribution[key]
    }

    const totalRatings = Object.values(stats.ratingDistribution).reduce((sum, count) => sum + count, 0)
    const weightedSum = Object.entries(stats.ratingDistribution)
      .reduce((sum, [r, count]) => sum + (parseFloat(r) * count), 0)

    stats.averageRating = totalRatings > 0 ? weightedSum / totalRatings : 0
    stats.totalRatings = totalRatings

    transaction.update(mediaRef, { stats })
  })
}

// Favorite Media Operations
export async function updateFavoriteMedia(
  userId: string,
  mediaType: MediaType,
  mediaData: {
    mediaId: string
    title: string
    coverImage: string
  }
): Promise<void> {
  const updateData = {
    [`favoriteMedia.${mediaType}`]: mediaData,
    updatedAt: new Date(),
  }
  await updateDoc(doc(db, 'users', userId), updateData)
}

// Query Operations
export async function getUserMediaEntries(
  userId: string,
  mediaType?: MediaType
): Promise<Array<{ id: string; mediaId: string; type: MediaType } & MediaEntry>> {
  const entries: Array<{ id: string; mediaId: string; type: MediaType } & MediaEntry> = []

  const typesToQuery: MediaType[] = mediaType ? [mediaType] : ['movie', 'tv', 'book']

  for (const type of typesToQuery) {
    const entriesRef = collection(db, 'users', userId, 'library', type, 'entries')
    const entriesSnapshot = await getDocs(entriesRef)

    for (const entryDoc of entriesSnapshot.docs) {
      const entryData = entryDoc.data() as MediaEntry
      entries.push({
        id: entryDoc.id,
        ...entryData,
        mediaId: entryData.mediaId,
        type,
      })
    }
  }

  // Sort by watchedAt descending
  entries.sort((a, b) => {
    const dateA = a.watchedAt instanceof Date ? a.watchedAt : a.watchedAt.toDate()
    const dateB = b.watchedAt instanceof Date ? b.watchedAt : b.watchedAt.toDate()
    return dateB.getTime() - dateA.getTime()
  })

  return entries
}

export async function getUserWatchlist(userId: string): Promise<string[]> {
  const userDoc = await getDoc(doc(db, 'users', userId))
  if (!userDoc.exists()) return []
  return userDoc.data().watchlist || []
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const usersRef = collection(db, 'users')
  const usersSnapshot = await getDocs(usersRef)
  return usersSnapshot.docs.map(d => ({
    ...d.data(),
    uid: d.id,
  })) as UserProfile[]
}
