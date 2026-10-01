import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// docs/kairos/34 §2: a constitution amendment is accepted only by the
// operator. A Bearer caller (API key / OAuth / mobile / master key) gets a 403
// for kind 'constitution_amendment'; a signed-in session still accepts it, and
// other proposal kinds are unaffected.

const { acceptProposal, findMemoryById, authenticateRequest } = vi.hoisted(() => ({
  acceptProposal: vi.fn(),
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
vi.mock('@/lib/data/memories', () => ({ findMemoryById }))
vi.mock('@/lib/kairos/proposal-accept', () => ({ acceptKairosProposal: acceptProposal }))

import { POST } from '../route'
import { OPERATOR_ONLY_AMENDMENT_ERROR } from '@/lib/kairos/constitution/amendment'

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>

const PROPOSAL_ID = '50000000-0000-4000-8000-000000000001'

const amendment = {
  id: PROPOSAL_ID,
  type: 'inbound',
  sourceMetadata: { introspection: true, kind: 'constitution_amendment', status: 'pending' },
}
const reflection = {
  id: PROPOSAL_ID,
  type: 'inbound',
  sourceMetadata: { introspection: true, kind: 'reflection', status: 'pending' },
}

async function accept(headers: Record<string, string> = {}) {
  const req = new NextRequest(`https://aeon.shadow-lab.ai/api/v1/memories/${PROPOSAL_ID}/accept`, {
    method: 'POST',
    headers,
  })
  const res = await (POST as unknown as Handler)(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateRequest.mockResolvedValue({ id: 'user-1', role: 'user' })
  acceptProposal.mockResolvedValue({ ok: true, memory: { id: 'accepted-1' } })
})

describe('POST /api/v1/memories/[id]/accept — constitution amendments', () => {
  it.each(['aeon_k1_apikey', 'aeon_at_oauth', 'aeon_s1_mobile', 'master-key'])(
    'refuses a constitution amendment for a Bearer caller (%s)',
    async (token) => {
      findMemoryById.mockResolvedValue(amendment)
      const res = await accept({ authorization: `Bearer ${token}` })
      expect(res.status).toBe(403)
      expect(res.body.error).toBe(OPERATOR_ONLY_AMENDMENT_ERROR)
      expect(findMemoryById).toHaveBeenCalledWith(PROPOSAL_ID, 'user-1')
      expect(acceptProposal).not.toHaveBeenCalled()
    },
  )

  it('lets the operator\'s signed-in session accept a constitution amendment', async () => {
    findMemoryById.mockResolvedValue(amendment)
    const res = await accept()
    expect(res.status).toBe(200)
    expect(acceptProposal).toHaveBeenCalledWith(PROPOSAL_ID, 'user-1', expect.any(Object), { origin: { kind: 'operator', via: 'rest-session' } })
  })

  it('still lets a Bearer caller accept other proposal kinds', async () => {
    findMemoryById.mockResolvedValue(reflection)
    const res = await accept({ authorization: 'Bearer aeon_k1_apikey' })
    expect(res.status).toBe(200)
    expect(acceptProposal).toHaveBeenCalledTimes(1)
    // A bearer accept is an AI client's, not the operator's endorsement.
    expect(vi.mocked(acceptProposal).mock.calls[0][3]).toEqual({ origin: { kind: 'agent', via: 'rest' } })
  })

  it('falls through to the normal 404 when the memory does not exist', async () => {
    findMemoryById.mockResolvedValue(null)
    acceptProposal.mockResolvedValue(null)
    const res = await accept({ authorization: 'Bearer aeon_k1_apikey' })
    expect(res.status).toBe(404)
  })
})
