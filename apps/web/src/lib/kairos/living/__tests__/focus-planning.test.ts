import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Living Dominions lane B: nightly archetype / cortex / concept planning and
// the archetype + cortex crons skip dormant Dominions only when the switch is on.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  hasLiveOpenJob: vi.fn(async () => false),
  isJobDone: vi.fn(async () => false),
  listJobs: vi.fn(async () => []),
  listDominionsWithArchetypesSince: vi.fn(),
}))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(), inspectDominion: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), validAsOfNow: 'mock-valid-as-of-now' }))
vi.mock('@/lib/data/concepts', () => ({
  createConceptWithOp: vi.fn(),
  listConceptCandidates: vi.fn(async () => []),
  listConceptHistory: vi.fn(async () => []),
  updateConceptWithOp: vi.fn(),
}))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: vi.fn() }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('@/lib/kairos/archetypes', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/kairos/archetypes')>()),
  alreadyRanToday: vi.fn(async () => false),
  gatherArchetypeContext: vi.fn(),
}))
vi.mock('@/lib/kairos/cortex', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/kairos/cortex')>()),
  alreadyRanToday: vi.fn(async () => false),
  gatherCortexContext: vi.fn(),
}))

import { findDominionsByUser } from '@/lib/data/dominions'
import { listDominionsWithArchetypesSince } from '@/lib/data/thinking-jobs'
import { listConceptCandidates } from '@/lib/data/concepts'
import * as archetypes from '@/lib/kairos/archetypes'
import * as cortex from '@/lib/kairos/cortex'
import { archetypeHandler } from '../../thinking/handlers/archetype'
import { cortexHandler } from '../../thinking/handlers/cortex'
import { planConcepts } from '../../thinking/handlers/concept'

const USER = 'user-1'
const at = (iso: string) => new Date(iso)

const roster = [
  { id: 'live', name: 'Live', archivedAt: null, focusState: 'active', pinned: false },
  { id: 'dormant', name: 'Dormant', archivedAt: null, focusState: 'dormant', pinned: false },
  { id: 'pinned', name: 'Pinned', archivedAt: null, focusState: 'dormant', pinned: true },
  { id: 'archived', name: 'Archived', archivedAt: new Date(), focusState: 'active', pinned: false },
]

function archetypeCtx(dominionId: string) {
  const row = { id: `r-${dominionId}`, title: 'R', type: 'agentic', streamClass: 'agentic', summary: null, pinned: false, createdAt: new Date('2026-09-30T10:00:00Z') }
  return { dominionId, name: dominionId, vision: null, missionLong: null, objectives: [], boardTasks: [], recent: [row], pinned: [], reflections: [], existing: [] }
}

function cortexCtx(dominionId: string) {
  return { dominionId, name: dominionId, vision: 'A vision', missionLong: null, objectives: [], boardTasks: [], reflections: [], archetypes: [], prior: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_LIVING_DOMINIONS', '')
  vi.mocked(findDominionsByUser).mockResolvedValue(roster as never)
  vi.mocked(archetypes.gatherArchetypeContext).mockImplementation(async (_u, d) => archetypeCtx(d) as never)
  vi.mocked(cortex.gatherCortexContext).mockImplementation(async (_u, d) => cortexCtx(d) as never)
  vi.mocked(listDominionsWithArchetypesSince).mockResolvedValue(new Set(['live']) as never)
})

afterEach(() => vi.unstubAllEnvs())

async function planned(): Promise<Record<string, string[]>> {
  vi.mocked(listConceptCandidates).mockClear()
  const archetype = (await archetypeHandler.plan(USER, at('2026-10-01T02:00:00Z'))).map((s) => s.dominionId!)
  const cortexJobs = (await cortexHandler.plan(USER, at('2026-10-01T02:40:00Z'))).map((s) => s.dominionId!)
  await planConcepts(USER, at('2026-10-04T05:00:00Z'))
  const concept = vi.mocked(listConceptCandidates).mock.calls.map((c) => c[1])
  return { archetype, cortex: cortexJobs, concept }
}

describe('nightly synthesis planning under Living Dominions', () => {
  it('plans every non-archived Dominion when the switch is off', async () => {
    expect(await planned()).toEqual({
      archetype: ['live', 'dormant', 'pinned'],
      cortex: ['live', 'dormant', 'pinned'],
      concept: ['live', 'dormant', 'pinned'],
    })
  })

  it("plans exactly as off in 'observe'", async () => {
    const off = await planned()
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', 'observe')
    expect(await planned()).toEqual(off)
  })

  it("skips dormant Dominions but keeps pinned ones when 'on'", async () => {
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', '1')
    expect(await planned()).toEqual({
      archetype: ['live', 'pinned'],
      cortex: ['live', 'pinned'],
      concept: ['live', 'pinned'],
    })
    expect(archetypes.gatherArchetypeContext).not.toHaveBeenCalledWith(USER, 'dormant')
    expect(cortex.gatherCortexContext).not.toHaveBeenCalledWith(USER, 'dormant')
  })
})

describe('archetype + cortex crons under Living Dominions', () => {
  // The per-Dominion runner hits the empty mocked DB and errors, so each
  // result just records which Dominions the cron visited.
  async function visited() {
    const a = (await archetypes.runArchetypeSynthesisForUser(USER)).map((r) => r.dominionId)
    const c = (await cortex.runCortexRegenForUser(USER)).map((r) => r.dominionId)
    return { a, c }
  }

  it("visits every non-archived Dominion when off or 'observe'", async () => {
    expect(await visited()).toEqual({ a: ['live', 'dormant', 'pinned'], c: ['live', 'dormant', 'pinned'] })
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', 'observe')
    expect(await visited()).toEqual({ a: ['live', 'dormant', 'pinned'], c: ['live', 'dormant', 'pinned'] })
  })

  it("leaves dormant Dominions alone when 'on'", async () => {
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', 'on')
    expect(await visited()).toEqual({ a: ['live', 'pinned'], c: ['live', 'pinned'] })
  })
})
