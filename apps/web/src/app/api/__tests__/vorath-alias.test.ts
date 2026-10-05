import { describe, expect, it, vi } from 'vitest'

const redirect = vi.fn((url: URL) => ({ redirectTo: url.toString() }))
vi.mock('@/lib/auth', () => ({ auth: (fn: unknown) => fn }))
vi.mock('next/server', () => ({
  NextResponse: { next: () => ({ next: true }), redirect: (url: URL) => redirect(url), json: () => ({}) },
}))

import nextConfig from '../../../../next.config'
import middleware, { config } from '@/middleware'

type Rewrite = { source: string; destination: string }

function middlewareRunsOn(pathname: string): boolean {
  return config.matcher.some((p: string) => new RegExp(`^${p}$`).test(pathname))
}

function runMiddleware(pathname: string, authed: boolean) {
  const handler = middleware as unknown as (req: unknown) => unknown
  return handler({
    method: 'GET',
    nextUrl: { pathname },
    url: `http://localhost${pathname}`,
    headers: new Headers(),
    auth: authed ? { user: { id: 'u1' } } : null,
  })
}

describe('Vorath rename — REST alias and page guard', () => {
  it('rewrites /api/v1/vorath/* onto the /api/v1/kairos/* handlers', async () => {
    const rewrites = (await nextConfig.rewrites!()) as Rewrite[]
    expect(rewrites).toContainEqual({ source: '/api/v1/vorath/:path*', destination: '/api/v1/kairos/:path*' })
  })

  it('keeps the alias out of middleware so route-level API auth stays the only gate', () => {
    expect(middlewareRunsOn('/api/v1/vorath/today')).toBe(false)
    expect(middlewareRunsOn('/api/v1/kairos/today')).toBe(false)
  })

  it.each(['/vorath', '/kairos'])('redirects an anonymous visitor on %s to login', (pathname) => {
    expect(middlewareRunsOn(pathname)).toBe(true)
    const res = runMiddleware(pathname, false) as { redirectTo: string }
    expect(res.redirectTo).toBe(`http://localhost/login?callbackUrl=${encodeURIComponent(pathname)}`)
  })

  it('lets a signed-in user through to /vorath', () => {
    expect(runMiddleware('/vorath', true)).toEqual({ next: true })
  })
})
