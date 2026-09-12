import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Production acceptance (11 September, check 4) asked this route for
// `not-a-uuid` and `../../etc` and got a 500: the raw path segment went
// straight into a query and Postgres refused the malformed uuid literal.
// A syntactically impossible id cannot name a project the caller may see, so
// it must never reach the database and must read as a plain miss.

const { findProjectById, updateProject, deleteProject } = vi.hoisted(() => ({
  findProjectById: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
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
    // Mirrors the real wrapper, whose only answer to a driver error is a 500.
    apiHandler: (handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
      async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, ctx)
        } catch {
          return jsonResponse({ error: 'Internal server error' }, { status: 500 })
        }
      },
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})

vi.mock('@/lib/data/projects', () => ({ findProjectById, updateProject, deleteProject }))

import { GET, PUT, DELETE } from '../route'

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>

const REAL_ID = '40000000-0000-4000-8000-000000000001'
// What the suite actually sends, once Next has decoded the path segment.
const MALFORMED = ['not-a-uuid', '../../etc', '', '40000000-0000-4000-8000-00000000000', "' OR 1=1 --"]

async function call(handler: unknown, id: string, body?: unknown) {
  const request = new NextRequest(`https://aeon.shadow-lab.ai/api/v1/projects/${encodeURIComponent(id)}`, {
    method: body === undefined ? 'GET' : 'PUT',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const response = await (handler as Handler)(request, { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  findProjectById.mockResolvedValue({ id: REAL_ID, name: 'Aeon OS production verification' })
  updateProject.mockResolvedValue({ id: REAL_ID, name: 'renamed' })
  deleteProject.mockResolvedValue(true)
})

describe('GET /api/v1/projects/[id] — malformed id', () => {
  it.each(MALFORMED)('answers 404 without touching the database: %j', async (id) => {
    const { status, body } = await call(GET, id)

    expect(status).toBe(404)
    expect(body.error).toBe('Project not found')
    expect(findProjectById).not.toHaveBeenCalled()
  })

  it('leaks neither the id nor a stack trace', async () => {
    const { body } = await call(GET, '../../etc')

    expect(JSON.stringify(body)).not.toContain('etc')
    expect(JSON.stringify(body)).not.toMatch(/\bat\s|\.ts:\d+/)
  })

  it('still serves a well-formed id', async () => {
    const { status, body } = await call(GET, REAL_ID)

    expect(status).toBe(200)
    expect(findProjectById).toHaveBeenCalledWith(REAL_ID, 'user-1')
    expect((body.data as { id: string }).id).toBe(REAL_ID)
  })

  it('still answers 404 for a well-formed id that names nothing', async () => {
    findProjectById.mockResolvedValue(null)

    const { status } = await call(GET, '40000000-0000-4000-8000-0000000000ff')

    expect(status).toBe(404)
  })
})

describe('PUT and DELETE /api/v1/projects/[id] — malformed id', () => {
  it('refuses the write before reading or updating anything', async () => {
    const { status } = await call(PUT, 'not-a-uuid', { name: 'renamed' })

    expect(status).toBe(404)
    expect(findProjectById).not.toHaveBeenCalled()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it('refuses the delete before reading or deleting anything', async () => {
    const { status } = await call(DELETE, 'not-a-uuid')

    expect(status).toBe(404)
    expect(findProjectById).not.toHaveBeenCalled()
    expect(deleteProject).not.toHaveBeenCalled()
  })
})
