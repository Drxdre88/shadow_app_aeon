import { NextRequest } from 'next/server'
import { jsonResponse } from '@/lib/api/response'

export type RateLimitConfig = {
  windowMs: number
  maxRequests: number
}

export const API_READ_LIMIT: RateLimitConfig = { windowMs: 60_000, maxRequests: 200 }
export const API_WRITE_LIMIT: RateLimitConfig = { windowMs: 60_000, maxRequests: 60 }

type WindowEntry = { timestamps: number[] }

const store = new Map<string, WindowEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > now - 120_000)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}, 300_000)

export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const cutoff = now - config.windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

  const resetAt = entry.timestamps.length > 0
    ? entry.timestamps[0] + config.windowMs
    : now + config.windowMs

  if (entry.timestamps.length >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt }
  }

  entry.timestamps.push(now)
  const remaining = config.maxRequests - entry.timestamps.length
  return { allowed: true, remaining, resetAt }
}

export function withRateLimit(
  handler: (req: NextRequest, ctx: unknown) => Promise<Response>,
  config: RateLimitConfig
) {
  return async (req: NextRequest, ctx: unknown): Promise<Response> => {
    const masterKey = process.env.AEON_API_KEY
    const authHeader = req.headers.get('authorization')
    if (masterKey && authHeader === `Bearer ${masterKey}`) {
      return handler(req, ctx)
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown'

    const { allowed, remaining, resetAt } = checkRateLimit(ip, config)

    if (!allowed) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
      return jsonResponse(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(config.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
          },
        }
      )
    }

    const response = await handler(req, ctx)
    response.headers.set('X-RateLimit-Limit', String(config.maxRequests))
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
    return response
  }
}
