import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {}
    const pass = () => c
    Object.assign(c, { from: pass, where: pass, orderBy: pass, limit: pass })
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return c
  }
  return { db: { select: vi.fn(() => chain(selectQueue.shift() ?? [])), transaction: vi.fn() } }
})
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), validAsOfNow: 'mock-valid-as-of-now' }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(), inspectDominion: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({ isJobDone: vi.fn(async () => false) }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('../synthesis-change', async (importActual) => ({
  ...(await importActual<typeof import('../synthesis-change')>()),
  archetypeChangeCheck: vi.fn(async () => ({ run: false, reason: 'no_new_input' })),
  cortexChangeCheck: vi.fn(async () => ({ run: false, reason: 'no_new_input' })),
  aetherChangeCheck: vi.fn(async () => ({ run: false, reason: 'no_new_input' })),
}))

import { captureMemory } from '@/lib/data/memories'
import { inspectDominion } from '@/lib/data/dominions'
import { getProviderForTask } from '@/lib/ai/route-task'
import { runArchetypeSynthesisForDominion } from '../archetypes'
import { runCortexRegenForDominion } from '../cortex'
import { runAetherForUser } from '../aether'
import { NO_NEW_INPUT } from '../synthesis-change'

const USER = 'user-1'
const DOM = '11111111-1111-4111-8111-111111111111'

function traces() {
  return vi.mocked(captureMemory).mock.calls
    .map((c) => (c[1] as { streamClass?: string; sourceMetadata: Record<string, unknown> }))
    .filter((m) => m.streamClass === 'trace')
    .map((m) => m.sourceMetadata)
}

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
})

describe('fallback crons skip instead of rewriting when nothing new arrived', () => {
  it('archetypes: skipped, a skipped trace (health ok), no model call, no context read', async () => {
    selectQueue.push([{ id: DOM, name: 'AEON', archivedAt: null }], [{ n: 0 }])

    const res = await runArchetypeSynthesisForDominion(USER, DOM)

    expect(res).toMatchObject({ status: 'skipped', reason: NO_NEW_INPUT })
    expect(traces()).toEqual([expect.objectContaining({ cronName: 'archetype-synthesis', outcome: 'skipped', skipReason: NO_NEW_INPUT })])
    expect(traces()[0].reason).toBeUndefined()
    expect(inspectDominion).not.toHaveBeenCalled()
    expect(getProviderForTask).not.toHaveBeenCalled()
  })

  it('cortex: skipped with a skipped trace', async () => {
    selectQueue.push([{ id: DOM, name: 'AEON', archivedAt: null }], [{ n: 0 }])

    const res = await runCortexRegenForDominion(USER, DOM)

    expect(res).toMatchObject({ status: 'skipped', reason: NO_NEW_INPUT })
    expect(traces()).toEqual([expect.objectContaining({ cronName: 'cortex-regen', outcome: 'skipped' })])
    expect(getProviderForTask).not.toHaveBeenCalled()
  })

  it('aether: skipped with a skipped trace', async () => {
    selectQueue.push([{ n: 0 }])

    const res = await runAetherForUser(USER)

    expect(res).toEqual({ generated: false, reason: 'no_new_input' })
    expect(traces()).toEqual([expect.objectContaining({ cronName: 'aether-regen', outcome: 'skipped' })])
    expect(getProviderForTask).not.toHaveBeenCalled()
  })
})
