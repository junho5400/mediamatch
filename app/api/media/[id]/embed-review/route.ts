import { NextResponse } from 'next/server'
import { verifyAuth, AuthError } from '@/lib/auth/verifyAuth'
import { EmbedReviewRequestSchema } from '@/lib/validation/schemas'
import { getMediaWithCache } from '@/lib/services/mediaCache'

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifyAuth(request)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = EmbedReviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { review_text, media_type } = parsed.data
  // The URL [id] is the bare external id (e.g. "550" or "_ojXNuzgHRcC").
  // Strip a leading type prefix if a caller happened to pass the already-namespaced id.
  const prefix = `${media_type}-`
  const externalId = id.startsWith(prefix) ? id.slice(prefix.length) : id
  const media_id = `${media_type}-${externalId}`

  const update = async () =>
    fetch(`${ML_SERVICE_URL}/items/update-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id, review_text }),
    })

  let resp = await update()

  // Item not in Qdrant yet — embed catalog vector first, then retry blend.
  if (resp.status === 404) {
    const item = await getMediaWithCache(media_id, media_type, externalId)
    if (item) {
      const embedResp = await fetch(`${ML_SERVICE_URL}/items/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_id,
          title: item.title,
          description: item.description || '',
          genres: item.genres || [],
          media_type,
        }),
      })
      if (embedResp.ok) {
        resp = await update()
      }
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.error('ML embed-review error:', resp.status, text)
    return NextResponse.json({ error: 'Failed to update embedding' }, { status: 502 })
  }

  const data = await resp.json().catch(() => ({}))
  return NextResponse.json(data)
}
