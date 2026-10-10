import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withRateLimit } from '@/lib/api/rateLimit'
import { VOICE_FEED_LIMIT } from '../limits'

const ok = async () => new Response('ok')
const call = (handler: (r: NextRequest, c: unknown) => Promise<Response>, ip: string) =>
  handler(new NextRequest('https://aeon.test/x', { headers: { 'x-forwarded-for': ip } }), {})

beforeEach(() => {
  vi.stubEnv('AEON_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('voice feed rate limit', () => {
  it('has its own 60/min bucket that other routes on the same IP cannot drain', async () => {
    const ip = '203.0.113.7'
    const other = withRateLimit(ok, { windowMs: 60_000, maxRequests: 1 })
    expect((await call(other, ip)).status).toBe(200)
    expect((await call(other, ip)).status).toBe(429)

    const feed = withRateLimit(ok, VOICE_FEED_LIMIT)
    for (let i = 0; i < 60; i++) expect((await call(feed, ip)).status).toBe(200)
    expect((await call(feed, ip)).status).toBe(429)
  })

  it('unscoped configs keep sharing the plain IP bucket', async () => {
    const ip = '203.0.113.8'
    const a = withRateLimit(ok, { windowMs: 60_000, maxRequests: 2 })
    const b = withRateLimit(ok, { windowMs: 60_000, maxRequests: 2 })
    expect((await call(a, ip)).status).toBe(200)
    expect((await call(b, ip)).status).toBe(200)
    expect((await call(a, ip)).status).toBe(429)
  })
})
