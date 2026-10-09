import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CortexContext } from '@/lib/kairos/cortex-prompt'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  hasLiveOpenJob: vi.fn(async () => false),
  isJobDone: vi.fn(async () => false),
  listJobs: vi.fn(async () => []),
  countCortexRowsSince: vi.fn(async () => 1),
  listDominionsWithArchetypesSince: vi.fn(async () => new Set()),
}))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn(), inspectDominion: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), validAsOfNow: 'mock-valid-as-of-now' }))
vi.mock('@/lib/kairos/synthesis-change', () => ({
  archetypeChangeCheck: vi.fn(),
  cortexChangeCheck: vi.fn(),
  aetherChangeCheck: vi.fn(),
}))
vi.mock('@/lib/kairos/archetypes', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/kairos/archetypes')>()),
  alreadyRanToday: vi.fn(async () => false),
  gatherArchetypeContext: vi.fn(),
  persistArchetypes: vi.fn(),
}))
vi.mock('@/lib/kairos/cortex', () => ({ alreadyRanToday: vi.fn(async () => false), gatherCortexContext: vi.fn(), persistCortex: vi.fn() }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: vi.fn(async () => false), fetchAetherInputs: vi.fn(), persistAether: vi.fn() }))

import { findDominionsByUser } from '@/lib/data/dominions'
import { listDominionsWithArchetypesSince } from '@/lib/data/thinking-jobs'
import * as change from '@/lib/kairos/synthesis-change'
import * as archetypes from '@/lib/kairos/archetypes'
import * as cortex from '@/lib/kairos/cortex'
import * as aether from '@/lib/kairos/aether'
import { archetypeHandler } from '../handlers/archetype'
import { cortexHandler } from '../handlers/cortex'
import { aetherHandler } from '../handlers/aether'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM_A = '22222222-2222-4222-8222-222222222222'
const DOM_B = '33333333-3333-4333-8333-333333333333'
const REFL = '66666666-6666-4666-8666-666666666666'
const ARCH = '77777777-7777-4777-8777-777777777777'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)
const RUN = { run: true, reason: 'new_input' } as const
const SKIP = { run: false, reason: 'no_new_input' } as const

const substrate = (id: string, streamClass: string) => ({ id, title: 'Row', type: streamClass, streamClass, summary: null, pinned: false, createdAt: new Date('2026-09-30T10:00:00Z') })

function cortexCtx(dominionId: string): CortexContext {
  return {
    dominionId,
    name: 'AEON',
    vision: 'Fluid board app.',
    missionLong: null,
    objectives: [],
    boardTasks: [{ name: 'ship queue', status: 'open', priority: 'high', projectName: 'P' }],
    reflections: [{ id: REFL, title: 'Queue first', summary: null, createdAt: new Date('2026-09-30T10:00:00Z') }],
    archetypes: [{ id: ARCH, title: 'Brain build-out', summary: null, themes: [] }],
    prior: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('02:00'))
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM_A, archivedAt: null }, { id: DOM_B, archivedAt: null }] as never)
  vi.mocked(change.archetypeChangeCheck).mockResolvedValue(RUN)
  vi.mocked(change.cortexChangeCheck).mockResolvedValue(RUN)
  vi.mocked(change.aetherChangeCheck).mockResolvedValue(RUN)
  vi.mocked(listDominionsWithArchetypesSince).mockResolvedValue(new Set())
  vi.mocked(archetypes.gatherArchetypeContext).mockImplementation(async (_u, dom) => ({
    dominionId: dom, name: 'AEON', vision: null, missionLong: null, objectives: [], boardTasks: [],
    recent: [substrate(ARCH, 'agentic')], pinned: [], reflections: [substrate(REFL, 'reflection')], existing: [],
  }))
  vi.mocked(cortex.gatherCortexContext).mockImplementation(async (_u, dom) => cortexCtx(dom))
})

afterEach(() => { vi.useRealTimers() })

describe('archetype plan — change check', () => {
  it('plans no job for a Dominion with no new input, without reading its context', async () => {
    vi.mocked(change.archetypeChangeCheck).mockImplementation(async (_u, dom) => (dom === DOM_A ? SKIP : RUN))

    const specs = await archetypeHandler.plan(USER, at('02:00'))

    expect(specs.map((s) => s.dominionId)).toEqual([DOM_B])
    expect(archetypes.gatherArchetypeContext).not.toHaveBeenCalledWith(USER, DOM_A)
    expect(change.archetypeChangeCheck).toHaveBeenCalledWith(USER, DOM_A, at('02:00'))
  })
})

describe('cortex plan — change check', () => {
  it('plans no job for a Dominion whose cortex inputs did not change', async () => {
    vi.mocked(change.cortexChangeCheck).mockResolvedValue(SKIP)
    vi.mocked(listDominionsWithArchetypesSince).mockResolvedValue(new Set([DOM_A, DOM_B]))

    expect(await cortexHandler.plan(USER, at('02:40'))).toEqual([])
    expect(cortex.gatherCortexContext).not.toHaveBeenCalled()
  })

  it('treats archetypes that are not due as settled, and waits on ones that are', async () => {
    vi.mocked(change.archetypeChangeCheck).mockImplementation(async (_u, dom) => (dom === DOM_A ? SKIP : RUN))

    const specs = await cortexHandler.plan(USER, at('02:40'))

    expect(specs.map((s) => s.dominionId)).toEqual([DOM_A])
  })
})

describe('aether plan — change check', () => {
  it('plans nothing when no cortex was written since the live aether', async () => {
    vi.mocked(change.aetherChangeCheck).mockResolvedValue(SKIP)

    expect(await aetherHandler.plan(USER, at('03:00'))).toEqual([])
    expect(aether.fetchAetherInputs).not.toHaveBeenCalled()
  })
})
