import { describe, it, expect, vi } from 'vitest'

// middleware.ts runs `auth(cb)` and imports next/server at module load. Stub
// both so we can read the real `config.matcher` value without booting NextAuth
// or the DB — we only assert the matcher invariant here.
vi.mock('@/lib/auth', () => ({ auth: (fn: unknown) => fn }))
vi.mock('next/server', () => ({
  NextResponse: { next: () => ({}), redirect: () => ({}), json: () => ({}) },
}))

import { config } from '@/middleware'

// Faithful-enough replica of how Next compiles a string matcher: anchor the
// pattern and test full pathnames. If a path matches, middleware RUNS on it.
function middlewareRunsOn(pathname: string): boolean {
  return config.matcher.some((p: string) => new RegExp(`^${p}$`).test(pathname))
}

describe('middleware matcher — auth safety invariant', () => {
  // Regression for the 2026-06-08 login outage: the matcher ran the auth()
  // wrapper on /api/auth/*, which consumed the sign-in POST before the NextAuth
  // handler could return its redirect → 500 "No response from route handler".
  // Middleware must NEVER run on /api/* — those handlers own their own auth and
  // responses. If this test fails, login is about to break in production.
  it.each([
    '/api/auth/signin/google',
    '/api/auth/callback/google',
    '/api/auth/session',
    '/api/auth/csrf',
    '/api/auth/providers',
    '/api/v1/memories',
    '/api/mcp',
  ])('does NOT run on %s', (p) => {
    expect(middlewareRunsOn(p)).toBe(false)
  })

  // These DEPEND on middleware running: page guarding/redirects, and the
  // claude.ai OAuth discovery documents that are served from middleware.
  it.each([
    '/',
    '/dashboard',
    '/project/abc',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
  ])('DOES run on %s', (p) => {
    expect(middlewareRunsOn(p)).toBe(true)
  })

  // Static assets stay excluded (prior outage 8336cdc: middleware was
  // redirecting manifest.json / sw.js to /login).
  it.each([
    '/_next/static/chunk.js',
    '/manifest.json',
    '/sw.js',
  ])('does NOT run on static asset %s', (p) => {
    expect(middlewareRunsOn(p)).toBe(false)
  })
})
