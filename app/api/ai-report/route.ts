import { NextResponse } from "next/server"
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { verifyAuth, AuthError } from "@/lib/auth/verifyAuth"
import { adminDb } from "@/lib/firebase-admin"
import { callGemini, GeminiRateLimitError } from "@/lib/gemini/client"
import { generateAIReportPrompt } from "@/lib/gemini/prompts/ai-report"
import { rateLimit, getClientIP } from "@/lib/rate-limit"
import { AIReport } from "@/types/ai-report"
import { MediaEntry, MediaType } from "@/types/database"

type Entry = MediaEntry & { id: string; type: MediaType }

async function getUserEntriesAdmin(userId: string): Promise<Entry[]> {
  const types: MediaType[] = ["movie", "tv", "book"]
  const entries: Entry[] = []

  for (const type of types) {
    const snap = await adminDb
      .collection("users")
      .doc(userId)
      .collection("library")
      .doc(type)
      .collection("entries")
      .get()

    snap.forEach((doc) => {
      entries.push({ ...(doc.data() as MediaEntry), id: doc.id, type })
    })
  }

  return entries
}

function computeSignature(entries: Entry[]): string {
  // Signature changes whenever a new entry is logged OR an existing one is edited.
  // Using count + max(updatedAt) catches add, remove (count drops), and edit (updatedAt bumps).
  let latest = 0
  for (const e of entries) {
    const ts =
      e.updatedAt instanceof Date
        ? e.updatedAt.getTime()
        : (e.updatedAt as unknown as Timestamp)?.toMillis?.() ?? 0
    if (ts > latest) latest = ts
  }
  return `${entries.length}:${latest}`
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim()
}

export async function GET(req: Request) {
  let userId: string
  try {
    ;({ userId } = await verifyAuth(req))
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const ip = getClientIP(req)
  const { allowed, retryAfter } = rateLimit(ip, "ai-report")
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  }

  try {
    const entries = await getUserEntriesAdmin(userId)
    if (entries.length === 0) {
      return NextResponse.json({ error: "No media logged yet" }, { status: 404 })
    }

    const signature = computeSignature(entries)
    const userRef = adminDb.collection("users").doc(userId)
    const userSnap = await userRef.get()
    const cached = userSnap.data()?.aiReport as
      | { signature: string; report: AIReport; generatedAt: Timestamp }
      | undefined

    if (cached && cached.signature === signature && cached.report) {
      return NextResponse.json({ report: cached.report, cached: true })
    }

    // Cache miss — regenerate from Gemini
    const prompt = generateAIReportPrompt(entries)
    const raw = await callGemini(prompt)
    let report: AIReport
    try {
      report = JSON.parse(stripCodeFence(raw))
    } catch {
      console.error("AI report parse error. Raw response:", raw.slice(0, 500))
      return NextResponse.json({ error: "Failed to parse report" }, { status: 502 })
    }

    await userRef.set(
      {
        aiReport: {
          signature,
          report,
          generatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    return NextResponse.json({ report, cached: false })
  } catch (error) {
    console.error("AI report error:", error)
    if (error instanceof GeminiRateLimitError) {
      return NextResponse.json(
        { error: `Gemini rate limit reached. Try again in ${error.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      )
    }
    const message = error instanceof Error ? error.message : "Something went wrong"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
