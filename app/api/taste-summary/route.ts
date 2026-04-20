import { NextRequest, NextResponse } from "next/server"
import { verifyAuth, AuthError } from "@/lib/auth/verifyAuth"
import { getUserMediaEntriesAdmin } from "@/lib/firebase/firestore-admin"

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000"

/**
 * Generates a taste summary from the user's media library.
 * Uses the ML service's semantic search to find what themes
 * the user gravitates toward, instead of calling Gemini.
 */
export async function GET(req: NextRequest) {
  let userId: string

  try {
    const authResult = await verifyAuth(req)
    userId = authResult.userId
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const entries = await getUserMediaEntriesAdmin(userId)
    if (!entries?.length) {
      return NextResponse.json({ description: "" })
    }

    // Analyze the user's library to build a taste description
    const genreCounts: Record<string, number> = {}
    const typeCounts: Record<string, number> = {}
    let totalRating = 0
    let ratingCount = 0
    const topRated: { title: string; rating: number; type: string }[] = []

    for (const entry of entries) {
      // Count types
      typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1

      // Track ratings
      if (entry.rating) {
        totalRating += entry.rating
        ratingCount++
        topRated.push({ title: entry.title, rating: entry.rating, type: entry.type })
      }
    }

    // Sort top rated
    topRated.sort((a, b) => b.rating - a.rating)
    const favorites = topRated.slice(0, 3)

    // Try to get genre info from ML service for the user's top items
    let genreDescription = ""
    try {
      const ratedItems = entries.slice(0, 5).map(e => ({
        media_id: `${e.type}-${e.mediaId}`,
        rating: e.rating || 3,
        review: e.review || "",
      }))

      const res = await fetch(`${ML_SERVICE_URL}/recommendations/smart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rated_items: ratedItems, top_k: 10, intent: "for_you" }),
      })

      if (res.ok) {
        const data = await res.json()
        const recTypes = data.recommendations?.map((r: { media_type: string }) => r.media_type) || []
        const movieCount = recTypes.filter((t: string) => t === "movie").length
        const tvCount = recTypes.filter((t: string) => t === "tv").length
        const bookCount = recTypes.filter((t: string) => t === "book").length

        if (movieCount > tvCount && movieCount > bookCount) {
          genreDescription = "Our ML models suggest you gravitate toward films"
        } else if (bookCount > movieCount) {
          genreDescription = "Our ML models suggest you're drawn to literature"
        } else {
          genreDescription = "Our ML models see an eclectic taste across media types"
        }
      }
    } catch {} // Graceful fallback

    // Build description
    const parts: string[] = []

    if (favorites.length > 0) {
      const favTitles = favorites.map(f => f.title).join(", ")
      parts.push(`Your top picks include ${favTitles}.`)
    }

    const avgRating = ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : null
    if (avgRating) {
      parts.push(`You rate at ${avgRating}/5 on average across ${entries.length} logged items.`)
    }

    const typeBreakdown = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
      .join(", ")
    parts.push(`Your library: ${typeBreakdown}.`)

    if (genreDescription) {
      parts.push(genreDescription + ".")
    }

    return NextResponse.json({ description: parts.join(" ") })
  } catch (error) {
    console.error("Taste summary error:", error)
    return NextResponse.json({ error: "Failed to generate taste summary" }, { status: 500 })
  }
}
