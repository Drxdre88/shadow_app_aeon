import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { verifyProjectAccess, setProjectKairosFeed } = vi.hoisted(() => ({
  verifyProjectAccess: vi.fn(),
  setProjectKairosFeed: vi.fn(),
}))

vi.mock('@/lib/api/rateLimit', () => ({
  withRateLimit: (handler: unknown) => handler,
  API_READ_LIMIT: {},
  API_WRITE_LIMIT: {},
}))

vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: vi.fn(async () => ({ id: 'user-1', role: 'user' })),
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: unknown) => handler,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})

vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess, setProjectKairosFeed }))

import { PUT } from '../route'

const ID = '9c62a80f-491f-44de-b433-349ce3e0c1fe'

async function put(id: string, body: unknown) {
  const request = new NextRequest(`https://aeon.example/api/v1/projects/${id}/kairos-feed`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const response = await (PUT as (r: NextRequest, c: unknown) => Promise<Response>)(request, { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyProjectAccess.mockResolvedValue({ project: { id: ID }, role: 'owner' })
  setProjectKairosFeed.mockResolvedValue({ id: ID, settings: { kairosFeed: 'daily' } })
})

describe('PUT /api/v1/projects/[id]/kairos-feed', () => {
  it.each(['daily', 'weekly', null])('sets feed %j', async (feed) => {
    const { status, body } = await put(ID, { feed })
    expect(status).toBe(200)
    expect(body.data).toEqual({ projectId: ID, feed })
    expect(setProjectKairosFeed).toHaveBeenCalledWith(ID, feed)
  })

  it('400s an unknown mode or a missing field', async () => {
    expect((await put(ID, { feed: 'hourly' })).status).toBe(400)
    expect((await put(ID, {})).status).toBe(400)
    expect((await put(ID, 'not json')).status).toBe(400)
    expect(setProjectKairosFeed).not.toHaveBeenCalled()
  })

  it('404s a project the caller cannot see, and a malformed id, without writing', async () => {
    verifyProjectAccess.mockResolvedValue(null)
    expect((await put(ID, { feed: 'daily' })).status).toBe(404)
    expect((await put('not-a-uuid', { feed: 'daily' })).status).toBe(404)
    expect(setProjectKairosFeed).not.toHaveBeenCalled()
  })

  it('403s a member who is not the owner, without writing', async () => {
    verifyProjectAccess.mockResolvedValue({ project: { id: ID }, role: 'editor' })
    expect((await put(ID, { feed: 'daily' })).status).toBe(403)
    expect(setProjectKairosFeed).not.toHaveBeenCalled()
  })
})