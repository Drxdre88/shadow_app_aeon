import { describe, it, expect } from 'vitest'
import { jsonResponse, redirectResponse } from '@/lib/api/response'

// Realm-safety contract: route handlers MUST produce instances of the ACTIVE
// global Response class, or Next's app-route module rejects them ("No response
// is returned from route handler" → empty 500). `Response.json` and bundled
// `NextResponse.json` both violate this under the production server's lazy
// web-globals wrapper — these helpers are the guarded path.
describe('jsonResponse', () => {
  it('returns an instance of the active global Response', () => {
    const res = jsonResponse({ ok: true })
    expect(res instanceof globalThis.Response).toBe(true)
  })

  it('serializes the body and defaults content-type to application/json', async () => {
    const res = jsonResponse({ a: 1 }, { status: 201 })
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ a: 1 })
  })

  it('preserves caller headers and lets them override content-type', () => {
    const res = jsonResponse({}, { headers: { 'X-Custom': 'y', 'content-type': 'application/scim+json' } })
    expect(res.headers.get('x-custom')).toBe('y')
    expect(res.headers.get('content-type')).toBe('application/scim+json')
  })
})

describe('redirectResponse', () => {
  it('returns a same-realm 307 with Location by default', () => {
    const res = redirectResponse('https://example.com/next')
    expect(res instanceof globalThis.Response).toBe(true)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://example.com/next')
  })

  it('accepts URL objects and explicit status codes', () => {
    const res = redirectResponse(new URL('https://example.com/login'), 302)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://example.com/login')
  })
})
