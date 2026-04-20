// lib/recommendations/getRecommendations.ts

import { getUserMediaEntriesAdmin } from "@/lib/firebase/firestore-admin"
import { getMediaBatchWithCache } from "@/lib/services/mediaCache"
import { MediaItem } from "@/types/database"

export type RecommendationType = "for_you" | "popular"

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000"

// Recommendation cache: per-user, per-intent
const recCache = new Map<string, { items: MediaItem[], timestamp: number }>()
const REC_CACHE_TTL = 60 * 60 * 1000  // 1 hour

export function clearCache(userId: string) {
  recCache.delete(`${userId}:for_you`)
  recCache.delete(`${userId}:popular`)
  console.log(`Cache cleared for user ${userId}`)
}

interface MLRecommendation {
  media_id: string
  title: string
  media_type: string
  genres: string[]
  score: number
}

interface MLResponse {
  method: string
  recommendations: MLRecommendation[]
  count: number
}

/**
 * Fetches recommendations from the ML service, then enriches them
 * with full metadata via Firestore-cached lookups (TMDB/Google Books).
 */
export async function getRecommendations(type: RecommendationType, userId: string): Promise<MediaItem[]> {
  const logs = await getUserMediaEntriesAdmin(userId)
  const intent = type === "popular" ? "popular" : "for_you"

  // Check per-user rec cache
  const cacheKey = `${userId}:${intent}`
  const cached = recCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < REC_CACHE_TTL) {
    console.log(`Rec cache hit for ${cacheKey} (${cached.items.length} items)`)
    return cached.items
  }

  // Transform to ML service format
  const ratedItems = (logs || []).map(entry => ({
    media_id: `${entry.type}-${entry.mediaId}`,
    rating: entry.rating,
    review: entry.review || "",
  }))

  // Call ML service
  const mlResponse = await fetch(`${ML_SERVICE_URL}/recommendations/smart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rated_items: ratedItems, top_k: 20, intent }),
  })

  if (!mlResponse.ok) {
    console.error("ML service error:", mlResponse.status, await mlResponse.text())
    return []
  }

  const data: MLResponse = await mlResponse.json()
  console.log(`ML service returned ${data.recommendations?.length || 0} recs for ${intent}`)

  if (!data.recommendations?.length) return []

  // Enrich via shared Firestore-cached media fetcher
  // First call for an item hits TMDB/Books API + caches in Firestore
  // Subsequent calls (from any feature) read from Firestore — no API call
  const enriched = await getMediaBatchWithCache(data.recommendations)
  console.log(`Enriched: ${enriched.length}/${data.recommendations.length}`)

  // Cache the full result
  recCache.set(cacheKey, { items: enriched, timestamp: Date.now() })

  return enriched
}
