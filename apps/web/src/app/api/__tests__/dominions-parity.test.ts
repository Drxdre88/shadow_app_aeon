/**
 * Dominion focus + pin MCP <-> REST parity (Living Dominions, research/vorath_0510).
 *
 *   - get_dominion_focus <-> GET   /api/v1/dominions/focus
 *   - update_dominion    <-> PATCH /api/v1/dominions/[id]   (incl. pinned)
 * Both surfaces share updateDominionSchema and the same data functions, and
 * project assignment over MCP keeps board membership in step.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

const data = vi.hoisted(() => ({
  getDominionFocus: vi.fn(),
  assignProjectDominion: vi.fn(),
  updateDominion: vi.fn(),
  findDominionById: vi.fn(),
  verifyProjectAccess: vi.fn(),
  authenticateRequest: vi.fn(),
}))

vi.mock('@/lib/data/dominion-members', () => ({
  getDominionFocus: data.getDominionFocus,
  assignProjectDominion: data.assignProjectDominion,
}))
vi.mock('@/lib/data/dominions', () => ({
  updateDominion: data.updateDominion,
  findDominionById: data.findDominionById,
}))
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: data.verifyProjectAccess }))
vi.mock('@/lib/api/rateLimit', () => ({ withRateLimit: (h: unknown) => h, API_READ_LIMIT: {}, API_WRITE_LIMIT: {} }))
vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: data.authenticateRequest,
    isApiUser: (r: unknown) => typeof (r as { id?: unknown })?.id === 'string',
    apiHandler: (h: unknown) => h,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (body: unknown, status = 200) => jsonResponse({ data: body }, { status }),
  }
})

import { registerDominionTools } from '../[transport]/tools/dominions'
import { GET as focusGET } from '../v1/dominions/focus/route'
import { PATCH as dominionPATCH } from '../v1/dominions/[id]/route'

const SRC = path.resolve(__dirname, '../../..')
const MCP_FILE = path.join(SRC, 'app/api/[transport]/tools/dominions.ts')
const FOCUS_ROUTE = path.join(SRC, 'app/api/v1/dominions/focus/route.ts')
const ITEM_ROUTE = path.join(SRC, 'app/api/v1/dominions/[id]/route.ts')
const read = (p: string) => readFileSync(p, 'utf8')

type ToolHandler = (...args: unknown[]) => Promise<{ content: { text: string }[]; isError?: boolean }>
const tools = new Map<string, { schema: unknown; handler: ToolHandler }>()
registerDominionTools({
  tool: (name: string, _desc: string, schema: unknown, _ann: unknown, handler: ToolHandler) => {
    tools.set(name, { schema, handler })
  },
} as never)

const extra = { authInfo: { extra: { userId: 'u1' } } }
const D1 = '10000000-0000-4000-8000-000000000001'
const P1 = '20000000-0000-4000-8000-000000000002'
const FOCUS = { mode: 'observe', dominions: [{ id: D1, name: 'VORATH', dormant: false }], unattributed: null }

const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await tools.get(name)!.handler(args, extra)
  return { isError: !!res.isError, body: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) }
}

async function callRest(handler: unknown, url: string, init?: { method: string; body?: unknown; id?: string }) {
  const req = new NextRequest(`https://aeon.test${url}`, init?.body === undefined ? undefined : {
    method: init.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body),
  })
  const res = await (handler as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id: init?.id }) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  data.authenticateRequest.mockResolvedValue({ id: 'u1', role: 'user' })
  data.getDominionFocus.mockResolvedValue(FOCUS)
  data.updateDominion.mockImplementation(async (id: string, _u: string, patch: object) => ({ id, ...patch }))
})

describe('source parity', () => {
  const mcp = read(MCP_FILE)
  const focus = read(FOCUS_ROUTE)
  const item = read(ITEM_ROUTE)

  it('focus is read-only on both surfaces and uses the shared data fn', () => {
    expect(mcp).toMatch(/'get_dominion_focus'[\s\S]*?readOnlyHint: true/)
    expect(focus).toMatch(/export const GET\b/)
    expect(focus).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
    for (const src of [mcp, focus]) {
      expect(src).toMatch(/import \{[^}]*\bgetDominionFocus\b[^}]*\} from '@\/lib\/data\/dominion-members'/)
    }
  })

  it('update_dominion and PATCH share updateDominionSchema and updateDominion', () => {
    for (const src of [mcp, item]) {
      expect(src).toMatch(/import \{[^}]*\bupdateDominionSchema\b[^}]*\} from '@\/lib\/data\/validators'/)
      expect(src).toMatch(/updateDominionSchema\.safeParse\(/)
    }
    expect(mcp).toMatch(/_updateDominion\(dominionId, uid, parsed\.data\)/)
    expect(item).toMatch(/updateDominion\(id, result\.id, parsed\.data\)/)
  })

  it('MCP binds to the caller and REST authenticates', () => {
    expect(mcp).toMatch(/getUserId\(extra\)/)
    for (const src of [focus, item]) {
      expect(src).toMatch(/authenticateRequest\(/)
      expect(src).toMatch(/isApiUser\(result\)/)
    }
  })

  it('project assignment writes go through assignProjectDominion, not a bare project update', () => {
    expect(mcp).not.toMatch(/_updateProject\(/)
    expect(mcp.match(/assignProjectDominion\(/g) ?? []).toHaveLength(2)
  })
})

describe('get_dominion_focus <-> GET /api/v1/dominions/focus', () => {
  it('returns the same payload for the calling user', async () => {
    const mcp = await callTool('get_dominion_focus', {})
    const rest = await callRest(focusGET, '/api/v1/dominions/focus')
    expect(mcp.body).toEqual(FOCUS)
    expect(rest.status).toBe(200)
    expect(rest.body.data).toEqual(FOCUS)
    expect(data.getDominionFocus.mock.calls).toEqual([['u1'], ['u1']])
  })

  it('REST rejects an unauthenticated caller without reading', async () => {
    data.authenticateRequest.mockResolvedValue(new Response(null, { status: 401 }))
    const res = await (focusGET as unknown as (r: NextRequest) => Promise<Response>)(new NextRequest('https://aeon.test/api/v1/dominions/focus'))
    expect(res.status).toBe(401)
    expect(data.getDominionFocus).not.toHaveBeenCalled()
  })
})

describe('update_dominion <-> PATCH /api/v1/dominions/[id] — pinned', () => {
  it('both pass pinned through the shared schema to updateDominion', async () => {
    await callTool('update_dominion', { dominionId: D1, pinned: true })
    await callRest(dominionPATCH, `/api/v1/dominions/${D1}`, { method: 'PATCH', body: { pinned: true }, id: D1 })
    expect(data.updateDominion.mock.calls).toEqual([[D1, 'u1', { pinned: true }], [D1, 'u1', { pinned: true }]])
  })

  it('both reject a non-boolean pinned', async () => {
    const mcp = await callTool('update_dominion', { dominionId: D1, pinned: 'yes' })
    const rest = await callRest(dominionPATCH, `/api/v1/dominions/${D1}`, { method: 'PATCH', body: { pinned: 'yes' }, id: D1 })
    expect(mcp.isError).toBe(true)
    expect(rest.status).toBe(400)
    expect(data.updateDominion).not.toHaveBeenCalled()
  })

  it('both answer not-found when the Dominion is not the caller\'s', async () => {
    data.updateDominion.mockResolvedValue(null)
    const mcp = await callTool('update_dominion', { dominionId: D1, pinned: false })
    const rest = await callRest(dominionPATCH, `/api/v1/dominions/${D1}`, { method: 'PATCH', body: { pinned: false }, id: D1 })
    expect(mcp).toEqual({ isError: true, body: 'Dominion not found' })
    expect(rest.status).toBe(404)
  })

  it('REST 404s a malformed id without touching the data layer', async () => {
    const rest = await callRest(dominionPATCH, '/api/v1/dominions/x', { method: 'PATCH', body: { pinned: true }, id: 'not-a-uuid' })
    expect(rest.status).toBe(404)
    expect(data.updateDominion).not.toHaveBeenCalled()
  })
})

describe('assign_project_dominion / bulk — board membership', () => {
  beforeEach(() => {
    data.verifyProjectAccess.mockResolvedValue({ role: 'owner' })
    data.findDominionById.mockResolvedValue({ id: D1 })
    data.assignProjectDominion.mockResolvedValue({ id: P1, name: 'Board' })
  })

  it('assign routes through assignProjectDominion for the acting user', async () => {
    const out = await callTool('assign_project_dominion', { projectId: P1, dominionId: D1 })
    expect(out.body).toEqual({ projectId: P1, dominionId: D1, name: 'Board' })
    expect(data.assignProjectDominion).toHaveBeenCalledWith(P1, 'u1', D1)
  })

  it('clearing passes null through', async () => {
    await callTool('assign_project_dominion', { projectId: P1, dominionId: null })
    expect(data.assignProjectDominion).toHaveBeenCalledWith(P1, 'u1', null)
    expect(data.findDominionById).not.toHaveBeenCalled()
  })

  it('a foreign Dominion is refused before any write', async () => {
    data.findDominionById.mockResolvedValue(null)
    const out = await callTool('assign_project_dominion', { projectId: P1, dominionId: D1 })
    expect(out).toEqual({ isError: true, body: 'Dominion not found' })
    expect(data.assignProjectDominion).not.toHaveBeenCalled()
  })

  it('bulk assigns each accessible project the same way', async () => {
    data.verifyProjectAccess.mockImplementation(async (id: string) => (id === P1 ? { role: 'owner' } : null))
    const other = '30000000-0000-4000-8000-000000000003'
    const out = await callTool('bulk_assign_projects_to_dominion', { projectIds: [P1, other], dominionId: D1 })
    expect(out.body).toMatchObject({ updatedCount: 1, updated: [P1], skipped: [{ id: other, reason: 'not accessible' }] })
    expect(data.assignProjectDominion.mock.calls).toEqual([[P1, 'u1', D1]])
  })
})
