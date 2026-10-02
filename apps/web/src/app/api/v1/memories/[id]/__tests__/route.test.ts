import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Constitution archive guard (Phase 1): a bearer caller (API key / OAuth /
// mobile / master key) is an agent and may not archive, retype, rewrite or
// delete a constitution row. The operator's signed-in session still can.

const { updateMemory, deleteMemory, findMemoryById, authenticateRequest } = vi.hoisted(() => ({
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  findMemoryById: vi.fn(),
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

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/constitution', () => ({}))
vi.mock('@/lib/data/memories', () => ({ findMemoryById, updateMemory, deleteMemory }))

import { DELETE, PATCH } from '../route'
import { OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR } from '@/lib/kairos/constitution/amendment'
import { OPERATOR_ONLY_GOAL_ERROR } from '@/lib/kairos/goals/guards'

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>

const MEMORY_ID = '70000000-0000-4000-8000-000000000001'
const BEARER = 'Bearer aeon_k1_apikey'
const URL_ = `https://aeon.shadow-lab.ai/api/v1/memories/${MEMORY_ID}`
const ctx = { params: Promise.resolve({ id: MEMORY_ID }) }

const constitution = {
  id: MEMORY_ID,
  type: 'constitution',
  streamClass: 'constitution',
  title: 'Constitution v2',
  bodyMd: '# Constitution v2',
  summary: 'Constitution v2: 2 principles',
}
const note = { id: MEMORY_ID, type: 'note', streamClass: 'operator_capture', title: 'n', bodyMd: 'b', summary: null }

async function patch(body: unknown, headers: Record<string, string> = {}) {
  const req = new NextRequest(URL_, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const res = await (PATCH as unknown as Handler)(req, ctx)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function del(headers: Record<string, string> = {}) {
  const req = new NextRequest(URL_, { method: 'DELETE', headers })
  const res = await (DELETE as unknown as Handler)(req, ctx)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateRequest.mockResolvedValue({ id: 'user-1', role: 'user' })
  findMemoryById.mockResolvedValue(constitution)
  updateMemory.mockResolvedValue({ ...constitution, archivedAt: new Date() })
  deleteMemory.mockResolvedValue(true)
})

describe('PATCH /api/v1/memories/[id] — constitution rows', () => {
  it('refuses a bearer caller archiving a constitution row', async () => {
    const res = await patch({ archivedAt: '2026-10-02T00:00:00.000Z' }, { authorization: BEARER })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR)
    expect(findMemoryById).toHaveBeenCalledWith(MEMORY_ID, 'user-1')
    expect(updateMemory).not.toHaveBeenCalled()
  })

  it('refuses a bearer caller retyping a constitution row', async () => {
    const res = await patch({ type: 'note' }, { authorization: BEARER })
    expect(res.status).toBe(403)
    expect(updateMemory).not.toHaveBeenCalled()
  })

  it('lets a bearer caller backfill the summary fields', async () => {
    const res = await patch({ aiTitle: 'Core principles', execSummary: ['a'] }, { authorization: BEARER })
    expect(res.status).toBe(200)
    expect(updateMemory).toHaveBeenCalledWith(MEMORY_ID, 'user-1', expect.any(Object), { origin: { kind: 'agent', via: 'rest' } })
  })

  it('lets the signed-in session archive a constitution row', async () => {
    const res = await patch({ archivedAt: '2026-10-02T00:00:00.000Z' })
    expect(res.status).toBe(200)
    expect(updateMemory).toHaveBeenCalledWith(
      MEMORY_ID, 'user-1', { archivedAt: '2026-10-02T00:00:00.000Z' },
      { origin: { kind: 'operator', via: 'rest-session' } },
    )
  })

  it('still lets a bearer caller archive an ordinary memory', async () => {
    findMemoryById.mockResolvedValue(note)
    const res = await patch({ archivedAt: '2026-10-02T00:00:00.000Z' }, { authorization: BEARER })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/v1/memories/[id] — constitution rows', () => {
  it('refuses a bearer caller deleting a constitution row', async () => {
    const res = await del({ authorization: BEARER })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR)
    expect(deleteMemory).not.toHaveBeenCalled()
  })

  it('refuses a superseded constitution version too', async () => {
    findMemoryById.mockResolvedValue({ ...constitution, supersededAt: new Date('2026-09-01') })
    const res = await del({ authorization: BEARER })
    expect(res.status).toBe(403)
  })

  it('lets a bearer caller delete an ordinary memory', async () => {
    findMemoryById.mockResolvedValue(note)
    const res = await del({ authorization: BEARER })
    expect(res.status).toBe(200)
    expect(deleteMemory).toHaveBeenCalledWith(MEMORY_ID, 'user-1')
  })

  it('lets the signed-in session delete without the guard lookup', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(findMemoryById).not.toHaveBeenCalled()
  })
})

describe('/api/v1/memories/[id] — Kairos goal rows (Phase 2)', () => {
  const proposal = { id: MEMORY_ID, type: 'inbound', streamClass: 'agentic', title: 'Goal', bodyMd: 'b', summary: 'q', sourceMetadata: { kind: 'goal', status: 'pending' } }
  const approved = { ...proposal, type: 'kairos_goal', sourceMetadata: { status: 'accepted' } }

  it.each([['a pending proposal', proposal], ['an approved goal', approved]])('refuses a bearer archiving (vetoing) %s', async (_label, row) => {
    findMemoryById.mockResolvedValue(row)
    const res = await patch({ archivedAt: '2026-10-02T00:00:00.000Z' }, { authorization: BEARER })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(OPERATOR_ONLY_GOAL_ERROR)
    expect(updateMemory).not.toHaveBeenCalled()
  })

  it('refuses a bearer rewriting a goal but allows a summary backfill', async () => {
    findMemoryById.mockResolvedValue(approved)
    expect((await patch({ bodyMd: 'new' }, { authorization: BEARER })).status).toBe(403)
    expect((await patch({ aiTitle: 'Desk blocker' }, { authorization: BEARER })).status).toBe(200)
  })

  it('refuses a bearer deleting a goal row', async () => {
    findMemoryById.mockResolvedValue(proposal)
    const res = await del({ authorization: BEARER })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(OPERATOR_ONLY_GOAL_ERROR)
    expect(deleteMemory).not.toHaveBeenCalled()
  })

  it('leaves the signed-in session ungated', async () => {
    findMemoryById.mockResolvedValue(proposal)
    expect((await patch({ archivedAt: '2026-10-02T00:00:00.000Z' })).status).toBe(200)
    expect((await del()).status).toBe(200)
  })
})
