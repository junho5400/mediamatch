import { NextResponse } from "next/server"
import { callGemini, GeminiRateLimitError } from "@/lib/gemini/client"
import { verifyAuth, AuthError } from "@/lib/auth/verifyAuth"
import { ChatbotRequestSchema, sanitizeForPrompt } from "@/lib/validation/schemas"
import { rateLimit, getClientIP } from "@/lib/rate-limit"

export async function POST(req: Request) {
  try {
    await verifyAuth(req)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const ip = getClientIP(req)
  const { allowed, retryAfter } = rateLimit(ip, 'chatbot')
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const body = await req.json()
    const parsed = ChatbotRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
    }

    const { message, mediaLog } = parsed.data

    const simplified = mediaLog.map((e) => ({
      title: e.title,
      type: e.type,
      rating: e.rating,
      tag: e.tag,
      review: e.review,
    }))

    const sanitizedMessage = sanitizeForPrompt(message)

    const prompt = `You are a friendly and knowledgeable AI media expert. You help users discover interesting movies, TV shows, and books.

The user has the following media history:
${JSON.stringify(simplified, null, 2)}

They just said:
"${sanitizedMessage}"

Based on both their message and media history, reply in a conversational and helpful tone. Feel free to reference things they've liked, suggest new options, or ask follow-up questions.

AI:`

    const reply = await callGemini(prompt)
    return NextResponse.json({ reply })
  } catch (error) {
    console.error("Chatbot error:", error)
    if (error instanceof GeminiRateLimitError) {
      return NextResponse.json(
        { error: `Gemini free-tier rate limit reached. Try again in ${error.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      )
    }
    const message = error instanceof Error ? error.message : "Something went wrong"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
