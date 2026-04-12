interface RateLimitEntry {
  tokens: number
  lastRefill: number
}

interface RateLimitConfig {
  maxTokens: number
  refillRate: number // tokens per second
  windowMs: number
}

const buckets = new Map<string, RateLimitEntry>()

const CONFIGS: Record<string, RateLimitConfig> = {
  chatbot: { maxTokens: 10, refillRate: 10 / 60, windowMs: 60_000 },
  'ai-report': { maxTokens: 5, refillRate: 5 / 3600, windowMs: 3600_000 },
  search: { maxTokens: 30, refillRate: 30 / 60, windowMs: 60_000 },
  default: { maxTokens: 60, refillRate: 1, windowMs: 60_000 },
}

// Clean up stale entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of buckets) {
    if (now - entry.lastRefill > 3600_000) {
      buckets.delete(key)
    }
  }
}, 300_000)

export function rateLimit(identifier: string, endpoint: string): { allowed: boolean; retryAfter?: number } {
  const config = CONFIGS[endpoint] || CONFIGS.default
  const key = `${endpoint}:${identifier}`
  const now = Date.now()

  let entry = buckets.get(key)
  if (!entry) {
    entry = { tokens: config.maxTokens, lastRefill: now }
    buckets.set(key, entry)
  }

  // Refill tokens based on elapsed time
  const elapsed = (now - entry.lastRefill) / 1000
  entry.tokens = Math.min(config.maxTokens, entry.tokens + elapsed * config.refillRate)
  entry.lastRefill = now

  if (entry.tokens < 1) {
    const retryAfter = Math.ceil((1 - entry.tokens) / config.refillRate)
    return { allowed: false, retryAfter }
  }

  entry.tokens -= 1
  return { allowed: true }
}

export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') || 'unknown'
}
