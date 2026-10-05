import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Spawn-time anchor access on BOTH surfaces: a session anchored to a card
// writes back to it (result, column, Plan checklist, follow-up seeds), so
// POST /api/v1/sessions and MCP spawn_session refuse a card or project the
// caller cannot edit — before any row is created.

const USER_ID = '10000000-0000-4000-8000-000000000001'
const TASK_ID = '30000000-0000-4000-8000-000000000001'
const PROJECT_ID = '40000000-0000-4000-8000-000000000001'
const OTHER_PROJECT = '40000000-0000-4000-8000-0000000000ff'

const m = vi.hoisted(() => ({
  cardRows: [] as unknown[],
  verifyProjectAccess: vi.fn(),
  createAgentSession: vi.fn(),
}))

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  chain.from = pass
  chain.where = pass
  chain.limit = () => Promise.resolve(m.cardRows)
  return { db: { select: () => chain } }
})
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: m.verifyProjectAccess }))
vi.mock('@/lib/data/sessions', () => ({
  LiveMissionExistsError: class extends Error {},
  createAgentSession: m.createAgentSession,
  findLiveSessionForTask: vi.fn(async () => null),
  listAgentSessions: vi.fn(async () => []),
  findAgentSessionById: vi.fn(async (id: string) => ({ id, status: 'queued' })),
  updateAgentSessionStatus: vi.fn(async () => null),
  recordSessionEvent: vi.fn(async () => null),
  listSessionEvents: vi.fn(async () => []),
  claimNextSession: vi.fn(async () => null),
}))
vi.mock('@/lib/kairos/spawn', () => ({ dispatchSpawn: vi.fn(async () => ({ dispatched: false, reason: 'pull-mode' })) }))
vi.mock('@/lib/api/rateLimit', () => ({ withRateLimit: (h: unknown) => h, API_READ_LIMIT: {}, API_WRITE_LIMIT: {} }))
vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: vi.fn(async () => ({ id: USER_ID, role: 'user' })),
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: unknown) => handler,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
    jsonData: (data: unknown, status = 200) => jsonResponse({ data }, { status }),
  }
})

import { POST } from '../route'
import { registerSessionTools } from '../../../[transport]/tools/sessions'
import { resolveSessionAnchor, SESSION_ANCHOR_DENIED } from '@/lib/data/hangar-access'

type ToolResult = { isError?: boolean; content: Array<{ text: string }> }
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>
const tools = new Map<string, ToolHandler>()
registerSessionTools({
  tool: (...args: unknown[]) => { tools.set(args[0] as string, args[args.length - 1] as ToolHandler) },
} as never)

const BODY = { engine: 'copilot', goal: 'Probe', prompt: 'Do not execute.', repo: 'aeon', metadata: { hangar: { objective: 'plan', phase: 'plan' } } }

async function rest(body: Record<string, unknown>) {
  const request = new NextRequest('https://aeon.test/api/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await (POST as unknown as (r: NextRequest, c: unknown) => Promise<Response>)(request, {})
  return { status: res.status, body: await res.json() as { error?: string } }
}

const mcp = (args: Record<string, unknown>) =>
  tools.get('spawn_session')!(args, { authInfo: { extra: { userId: USER_ID } } })

beforeEach(() => {
  vi.clearAllMocks()
  m.cardRows = [{ projectId: PROJECT_ID }]
  m.verifyProjectAccess.mockResolvedValue({ project: { id: PROJECT_ID }, role: 'editor' })
  m.createAgentSession.mockResolvedValue({ id: 'session-1', engine: 'copilot', repo: 'aeon', branch: null, goal: 'Probe', prompt: 'x' })
})

describe('spawn refuses a card the caller cannot edit', () => {
  it.each([
    ['not a member', null],
    ['a viewer', { project: { id: PROJECT_ID }, role: 'viewer' }],
  ])('REST answers 403 when the caller is %s of the card project', async (_label, access) => {
    m.verifyProjectAccess.mockResolvedValue(access)
    const { status, body } = await rest({ ...BODY, taskId: TASK_ID })
    expect(status).toBe(403)
    expect(body.error).toBe(SESSION_ANCHOR_DENIED)
    expect(m.verifyProjectAccess).toHaveBeenCalledWith(PROJECT_ID, USER_ID)
    expect(m.createAgentSession).not.toHaveBeenCalled()
  })

  it('MCP spawn_session refuses the same foreign card', async () => {
    m.verifyProjectAccess.mockResolvedValue(null)
    const out = await mcp({ ...BODY, taskId: TASK_ID })
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toBe(SESSION_ANCHOR_DENIED)
    expect(m.createAgentSession).not.toHaveBeenCalled()
  })

  it('both surfaces spawn when the caller edits the card project, pinning projectId to the card project', async () => {
    expect((await rest({ ...BODY, taskId: TASK_ID })).status).toBe(201)
    expect((await mcp({ ...BODY, taskId: TASK_ID })).isError).toBeUndefined()
    expect(m.createAgentSession).toHaveBeenCalledTimes(2)
    for (const [userId, input] of m.createAgentSession.mock.calls) {
      expect(userId).toBe(USER_ID)
      expect(input).toMatchObject({ taskId: TASK_ID, projectId: PROJECT_ID })
    }
  })

  it.each(['analysis', 'recon', 'implement'])('refuses a foreign card whatever the objective (%s), not only plan', async (objective) => {
    m.verifyProjectAccess.mockResolvedValue(null)
    const body = { ...BODY, taskId: TASK_ID, metadata: { hangar: { objective } } }
    expect((await rest(body)).status).toBe(403)
    expect((await mcp(body)).isError).toBe(true)
    expect(m.createAgentSession).not.toHaveBeenCalled()
  })

  it('gives a non-member the generic refusal even when the projectId conflicts (no card-existence leak)', async () => {
    m.verifyProjectAccess.mockResolvedValue(null)
    const body = { ...BODY, taskId: TASK_ID, projectId: OTHER_PROJECT }
    expect((await rest(body)).status).toBe(403)
    expect((await mcp(body)).content[0].text).toBe(SESSION_ANCHOR_DENIED)
    expect(m.createAgentSession).not.toHaveBeenCalled()
  })

  it('refuses a conflicting projectId on both surfaces', async () => {
    const body = { ...BODY, taskId: TASK_ID, projectId: OTHER_PROJECT }
    expect((await rest(body)).status).toBe(403)
    expect((await mcp(body)).content[0].text).toBe('taskId does not belong to projectId')
    expect(m.createAgentSession).not.toHaveBeenCalled()
  })
})

describe('resolveSessionAnchor', () => {
  it('refuses a missing card exactly like a foreign one', async () => {
    m.cardRows = []
    await expect(resolveSessionAnchor(USER_ID, { taskId: TASK_ID })).resolves.toEqual({ ok: false, message: SESSION_ANCHOR_DENIED })
  })

  it('pins the project to the card when only taskId is given', async () => {
    await expect(resolveSessionAnchor(USER_ID, { taskId: TASK_ID })).resolves.toEqual({ ok: true, projectId: PROJECT_ID })
  })

  it('checks a bare projectId anchor and allows unanchored sessions', async () => {
    m.verifyProjectAccess.mockResolvedValueOnce({ project: {}, role: 'viewer' })
    await expect(resolveSessionAnchor(USER_ID, { projectId: PROJECT_ID })).resolves.toEqual({ ok: false, message: SESSION_ANCHOR_DENIED })
    await expect(resolveSessionAnchor(USER_ID, {})).resolves.toEqual({ ok: true, projectId: null })
    expect(m.verifyProjectAccess).toHaveBeenCalledTimes(1)
  })
})
