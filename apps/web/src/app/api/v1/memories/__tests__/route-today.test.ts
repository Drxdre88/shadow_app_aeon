import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// One mind (spec_one_mind): a coding session's closing summary posted here is
// logged once in the today log — keyed per client session, agent origin for a
// bearer client — so every surface knows what the agents just did. Other
// memory types are not logged.

const { createMemory, authenticateRequest, recordTodayAfter } = vi.hoisted(() => ({
  createMemory: vi.fn(),
  authenticateRequest: vi.fn(),
  recordTodayAfter: vi.fn(),
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
vi.mock('@/lib/data/memories', () => ({ createMemory, listMemories: vi.fn(), getGraphForUser: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({ recordTodayAfter }))

import { POST } from '../route'

type Handler = (req: NextRequest) => Promise<Response>

function post(body: unknown, headers: Record<string, string> = { authorization: 'Bearer aeon_k1_test' }) {
  return (POST as unknown as Handler)(new NextRequest('https://aeon.shadow-lab.ai/api/v1/memories', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

const summary = {
  title: 'Wired the today log into prepare_context',
  bodyMd: 'Long body.',
  summary: 'prepare_context now shows today across channels.',
  type: 'session_summary',
  source: 'claude',
  sourceMetadata: { sessionId: 'sess-42' },
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateRequest.mockResolvedValue({ id: 'user-1' })
  createMemory.mockResolvedValue({ id: 'mem-1' })
})

describe('POST /api/v1/memories — session capture into the today log', () => {
  it('logs a session_summary once, keyed session:{client}:{sessionId}, with agent/rest origin', async () => {
    const res = await post(summary)

    expect(res.status).toBe(201)
    expect(recordTodayAfter).toHaveBeenCalledOnce()
    expect(recordTodayAfter).toHaveBeenCalledWith(
      'user-1',
      {
        key: 'session:claude:sess-42',
        channel: 'session',
        type: 'captured',
        text: 'claude session: Wired the today log into prepare_context — prepare_context now shows today across channels.',
        ref: { memoryId: 'mem-1' },
        covered: 'memory',
      },
      { kind: 'agent', via: 'rest' },
    )
  })

  it('uses the declared client for hook captures and the memory id when there is no sessionId', async () => {
    await post({ ...summary, source: 'hook', sourceMetadata: { client: 'codex' } })
    expect(recordTodayAfter.mock.calls[0][1].key).toBe('session:codex:mem-1')
  })

  it('does not log other memory types', async () => {
    await post({ ...summary, type: 'note' })
    expect(recordTodayAfter).not.toHaveBeenCalled()
  })
})
