import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { captureMemory } from '@/lib/data/memories'
import { captureMemorySchema } from '@/lib/data/validators'

// Kairos Phase 1 (A2) — single ingestion point for any inbound source.
// Bearer auth (session cookie or API key). The payload mirrors the create
// schema but adds `channel` for inbound normalisation. If sourceMetadata
// carries an `externalId`, the response will be 200 with `created: false`
// when a matching memory already exists — letting webhook retries land
// idempotently.

export const POST = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const auth = await authenticateRequest(request)
    if (!isApiUser(auth)) return auth

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = captureMemorySchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const { channel, ...rest } = parsed.data
    const { memory, created } = await captureMemory(auth.id, { ...rest, channel: channel ?? null })

    return jsonData({ memory, created }, created ? 201 : 200)
  }),
  API_WRITE_LIMIT
)
