import { env } from '@/lib/env'

const MODEL = "gemini-2.5-flash-lite"
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

interface GeminiResponse {
  candidates?: {
    content: {
      parts: { text: string }[]
    }
  }[]
}

const MAX_RETRIES = 3
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_WAIT_MS = 25_000

export class GeminiRateLimitError extends Error {
  retryAfterSeconds: number
  constructor(retryAfterSeconds: number, message = "Gemini rate limit exceeded") {
    super(message)
    this.name = "GeminiRateLimitError"
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function parseRetryDelayMs(body: string): number | null {
  try {
    const json = JSON.parse(body)
    const details = json?.error?.details as Array<Record<string, unknown>> | undefined
    const retryInfo = details?.find(
      (d) => typeof d["@type"] === "string" && (d["@type"] as string).includes("RetryInfo")
    )
    const delay = retryInfo?.retryDelay
    if (typeof delay === "string") {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(delay)
      if (m) return Math.ceil(parseFloat(m[1]) * 1000)
    }
  } catch {}
  return null
}

export async function callGemini(prompt: string): Promise<string> {
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      // Disable 2.5 Flash's "thinking" tokens — we don't need reasoning
      // for chat/report generation and it roughly 10x's latency and cost.
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(`${API_URL}?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (RETRYABLE_STATUSES.has(res.status)) {
      const errBody = await res.text().catch(() => "")
      const serverDelay = res.status === 429 ? parseRetryDelayMs(errBody) : null
      const backoff = Math.pow(2, attempt) * 1000
      const delay = Math.min(serverDelay ?? backoff, MAX_WAIT_MS)
      const isLast = attempt === MAX_RETRIES - 1
      console.warn(
        `Gemini ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES})${
          isLast ? ", giving up" : `, retrying in ${delay}ms`
        } — ${errBody.slice(0, 200)}`
      )
      if (res.status === 429 && (isLast || (serverDelay ?? 0) > MAX_WAIT_MS)) {
        throw new GeminiRateLimitError(Math.ceil((serverDelay ?? delay) / 1000))
      }
      lastError = new Error(`Gemini request failed: ${res.status} ${res.statusText}`)
      if (!isLast) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      continue
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      throw new Error(`Gemini request failed: ${res.status} ${res.statusText} — ${errBody.slice(0, 300)}`)
    }

    const json = (await res.json()) as GeminiResponse
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
      throw new Error("No content returned from Gemini")
    }

    return text.trim()
  }

  throw lastError || new Error("Gemini request failed after retries")
}
