import { beforeEach, describe, expect, it, vi } from 'vitest'

// The in-app spawn action anchors sessions through the same access check as
// REST POST /api/v1/sessions and MCP spawn_session.

const h = vi.hoisted(() => ({
  anchor: vi.fn(),
  create: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('../helpers', () => ({ requireAuth: vi.fn(async () => 'u1'), requireMemberAccess: vi.fn() }))
vi.mock('@/lib/data/hangar-access', () => ({ resolveSessionAnchor: h.anchor }))
vi.mock('@/lib/data/sessions', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createAgentSession: h.create,
  updateAgentSessionStatus: vi.fn(),
}))
vi.mock('@/lib/kairos/spawn', () => ({ dispatchSpawn: h.dispatch }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { spawnSessionAction } from '../sessions'

const TASK = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  h.dispatch.mockResolvedValue({ dispatched: false })
})

describe('spawnSessionAction anchor check', () => {
  it('refuses a card the caller cannot edit and creates no session', async () => {
    h.anchor.mockResolvedValue({ ok: false, message: 'You need editor access to the project this session is anchored to' })
    await expect(spawnSessionAction({ engine: 'claude', goal: 'g', prompt: 'p', taskId: TASK } as never)).rejects.toThrow(/editor access/)
    expect(h.create).not.toHaveBeenCalled()
  })

  it("pins projectId to the card's own project", async () => {
    h.anchor.mockResolvedValue({ ok: true, projectId: PROJECT })
    h.create.mockResolvedValue({ id: 's1', engine: 'claude', repo: null, branch: null, goal: 'g', prompt: 'p' })
    await spawnSessionAction({ engine: 'claude', goal: 'g', prompt: 'p', taskId: TASK } as never).catch(() => undefined)
    expect(h.anchor).toHaveBeenCalledWith('u1', { projectId: undefined, taskId: TASK })
    expect(h.create).toHaveBeenCalledWith('u1', expect.objectContaining({ taskId: TASK, projectId: PROJECT }))
  })
})
