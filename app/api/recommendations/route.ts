import { NextRequest, NextResponse } from "next/server"
import { verifyAuth, AuthError } from "@/lib/auth/verifyAuth"
import { getRecommendations, clearCache } from "@/lib/recommendations/getRecommendations"

export async function GET(req: NextRequest) {
  try {
    await verifyAuth(req)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const type = req.nextUrl.searchParams.get("type")
  const userId = req.nextUrl.searchParams.get("userId")

  const validTypes = ["personal", "broaden", "for_you", "popular"]
  if (!type || !userId || !validTypes.includes(type)) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  // Map legacy types to new ML service intents
  const intentMap: Record<string, "for_you" | "popular"> = {
    "personal": "for_you",
    "for_you": "for_you",
    "broaden": "popular",
    "popular": "popular",
  }
  const intent = intentMap[type]

  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1"
    if (refresh && userId) {
      clearCache(userId)
    }
    const recommendations = await getRecommendations(intent, userId)
    return NextResponse.json(recommendations)
  } catch (error) {
    console.error("Recommendations error:", error)
    return NextResponse.json({ error: "Failed to get recommendations" }, { status: 500 })
  }
}
