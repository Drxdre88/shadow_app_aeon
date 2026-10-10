import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  searchMemoriesHybrid: vi.fn(),
  listThinkingJobs: vi.fn(),
  listAgentSessions: vi.fn(),
  getDominionFocus: vi.fn(),
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
    authenticateRequest: m.authenticateRequest,
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: unknown) => handler,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})

vi.mock('@/lib/kairos/memory-search', () => ({ searchMemoriesHybrid: m.searchMemoriesHybrid }))
vi.mock('@/lib/kairos/agent-reads', () => ({ isEvalRead: () => true, noteAgentReads: vi.fn() }))
vi.mock('@/lib/kairos/thinking/queue', () => ({ listThinkingJobs: m.listThinkingJobs }))
vi.mock('@/lib/data/sessions', () => ({
  listAgentSessions: m.listAgentSessions,
  createAgentSession: vi.fn(),
  findAgentSessionById: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  recordSessionEvent: vi.fn(),
  findLiveSessionForTask: vi.fn(),
  LiveMissionExistsError: class extends Error {},
}))
vi.mock('@/lib/kairos/spawn', () => ({ dispatchSpawn: vi.fn() }))
vi.mock('@/lib/data/hangar-access', () => ({ resolveSessionAnchor: vi.fn() }))
vi.mock('@/lib/data/dominion-members', () => ({ getDominionFocus: m.getDominionFocus }))
vi.mock('@/lib/data/projects', () => ({
  verifyProjectAccess: m.verifyProjectAccess,
  setProjectKairosFeed: m.setProjectKairosFeed,
}))

import { GET as searchGET } from '../v1/memories/search/route'
import { GET as thinkingGET } from '../v1/kairos/thinking-jobs/route'
import { GET as sessionsGET } from '../v1/sessions/route'
import { GET as focusGET } from '../v1/dominions/focus/route'
import { PUT as feedPUT } from '../v1/projects/[id]/kairos-feed/route'

type Handler = (r: NextRequest, c: unknown) => Promise<Response>
const PID = '9c62a80f-491f-44de-b433-349ce3e0c1fe'

const ROUTES: Array<{ name: string; call: () => Promise<Response>; reads: () => ReturnType<typeof vi.fn> }> = [
  { name: 'GET memories/search', reads: () => m.searchMemoriesHybrid, call: () => (searchGET as Handler)(new NextRequest('https://aeon.test/api/v1/memories/search?q=launch'), {}) },
  { name: 'GET kairos/thinking-jobs', reads: () => m.listThinkingJobs, call: () => (thinkingGET as Handler)(new NextRequest('https://aeon.test/api/v1/kairos/thinking-jobs'), {}) },
  { name: 'GET sessions', reads: () => m.listAgentSessions, call: () => (sessionsGET as Handler)(new NextRequest('https://aeon.test/api/v1/sessions'), {}) },
  { name: 'GET dominions/focus', reads: () => m.getDominionFocus, call: () => (focusGET as Handler)(new NextRequest('https://aeon.test/api/v1/dominions/focus'), {}) },
  {
    name: 'PUT projects/[id]/kairos-feed',
    reads: () => m.setProjectKairosFeed,
    call: () => (feedPUT as Handler)(
      new NextRequest(`https://aeon.test/api/v1/projects/${PID}/kairos-feed`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feed: 'daily' }) }),
      { params: Promise.resolve({ id: PID }) },
    ),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VORATH_USER_IDS', 'owner-id')
  m.searchMemoriesHybrid.mockResolvedValue({ hits: [] })
  m.listThinkingJobs.mockResolvedValue([])
  m.listAgentSessions.mockResolvedValue([])
  m.getDominionFocus.mockResolvedValue({ dominions: [] })
  m.verifyProjectAccess.mockResolvedValue({ project: { id: PID }, role: 'owner' })
  m.setProjectKairosFeed.mockResolvedValue({ id: PID, settings: { kairosFeed: 'daily' } })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Vorath REST routes are owner-only', () => {
  it.each(ROUTES)('$name 404s a non-owner without touching data', async ({ call, reads }) => {
    m.authenticateRequest.mockResolvedValue({ id: 'beta-tester', role: 'admin' })
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(reads()).not.toHaveBeenCalled()
  })

  it.each(ROUTES)('$name lets the owner through', async ({ call, reads }) => {
    m.authenticateRequest.mockResolvedValue({ id: 'owner-id', role: 'user' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(reads()).toHaveBeenCalled()
  })

  it('still 401s an unauthenticated caller before the owner check', async () => {
    m.authenticateRequest.mockResolvedValue(new Response(null, { status: 401 }))
    expect((await ROUTES[0].call()).status).toBe(401)
  })

  it('falls back to KAIROS_OPERATOR_USER_ID when VORATH_USER_IDS is unset', async () => {
    vi.stubEnv('VORATH_USER_IDS', '')
    vi.stubEnv('KAIROS_OPERATOR_USER_ID', 'operator-id')
    m.authenticateRequest.mockResolvedValue({ id: 'operator-id', role: 'user' })
    expect((await ROUTES[2].call()).status).toBe(200)
    m.authenticateRequest.mockResolvedValue({ id: 'owner-id', role: 'user' })
    expect((await ROUTES[2].call()).status).toBe(404)
  })
})
