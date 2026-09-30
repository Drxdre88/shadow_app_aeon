import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { listMemoryOps, revertMemoryOp, authenticateRequest } = vi.hoisted(() => ({
  listMemoryOps: vi.fn(),
  revertMemoryOp: vi.fn(),
  authenticateRequest: vi.fn(),
}))

vi.mock('@/lib/api/rateLimit', () => ({
  withRateLimit: (handler: unknown) => handler,
  API_READ_LIMIT: {},
  API_WRITE_LIMIT: {},
}))

vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest,
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: (req: unknown, ctx: unknown) => Promise<Response>) => handler,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})

vi.mock('@/lib/data/memory-ops', () => ({ listMemoryOps }))
vi.mock('@/lib/kairos/engine/revert', () => ({ revertMemoryOp }))

import { GET } from '../route'
import { POST } from '../[id]/revert/route'

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>

const OP_ID = '30000000-0000-4000-8000-000000000001'
const MEMORY_ID = '40000000-0000-4000-8000-000000000001'

async function call(handler: unknown, url: string, method = 'GET', id?: string) {
  const req = new NextRequest(`https://aeon.shadow-lab.ai${url}`, { method })
  const res = await (handler as Handler)(req, id === undefined ? undefined : { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateRequest.mockResolvedValue({ id: 'user-1', role: 'user' })
  listMemoryOps.mockResolvedValue([{ id: OP_ID, op: 'promote' }])
})

describe('GET /api/v1/kairos/memory-ops', () => {
  it('lists the calling user\'s ops through the shared validator', async () => {
    const res = await call(GET, `/api/v1/kairos/memory-ops?memoryId=${MEMORY_ID}&op=promote&limit=5`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ count: 1, ops: [{ id: OP_ID, op: 'promote' }] })
    expect(listMemoryOps).toHaveBeenCalledWith('user-1', { memoryId: MEMORY_ID, ops: ['promote'], limit: 5 })
  })

  it('defaults the limit and omits filters', async () => {
    await call(GET, '/api/v1/kairos/memory-ops')
    expect(listMemoryOps).toHaveBeenCalledWith('user-1', { memoryId: undefined, ops: undefined, limit: 50 })
  })

  it('400s on an unknown op kind or malformed memoryId', async () => {
    expect((await call(GET, '/api/v1/kairos/memory-ops?op=nuke')).status).toBe(400)
    expect((await call(GET, '/api/v1/kairos/memory-ops?memoryId=nope')).status).toBe(400)
    expect(listMemoryOps).not.toHaveBeenCalled()
  })

  it('returns the auth response for an unauthenticated caller', async () => {
    authenticateRequest.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    expect((await call(GET, '/api/v1/kairos/memory-ops')).status).toBe(401)
    expect(listMemoryOps).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/kairos/memory-ops/[id]/revert', () => {
  const url = `/api/v1/kairos/memory-ops/${OP_ID}/revert`

  it('reverts the op for the calling user', async () => {
    revertMemoryOp.mockResolvedValue({ ok: true, opId: OP_ID, revertOpId: 'r', restoredMemoryIds: [MEMORY_ID] })
    const res = await call(POST, url, 'POST', OP_ID)
    expect(res.status).toBe(200)
    expect(revertMemoryOp).toHaveBeenCalledWith('user-1', OP_ID, expect.objectContaining({ reason: expect.any(String) }))
  })

  it('400s on a malformed id without touching the engine', async () => {
    expect((await call(POST, '/api/v1/kairos/memory-ops/x/revert', 'POST', 'x')).status).toBe(400)
    expect(revertMemoryOp).not.toHaveBeenCalled()
  })

  it('404s an unknown op and 409s a refused revert', async () => {
    revertMemoryOp.mockResolvedValueOnce({ ok: false, reason: 'not_found' })
    expect((await call(POST, url, 'POST', OP_ID)).status).toBe(404)
    revertMemoryOp.mockResolvedValueOnce({ ok: false, reason: 'already_reverted' })
    const refused = await call(POST, url, 'POST', OP_ID)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('already_reverted')
  })
})
