import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildCortexPrompt,
  CORTEX_SYSTEM_PROMPT,
  cortexGenSchema,
  cortexOutSchema,
  extractJsonBlock,
  groundCortexOutput,
  renderCortexMarkdown,
  type CortexContext,
  type CortexOutput,
} from '../cortex-prompt'

// Pure-function tests only below (see archetypes.test.ts for rationale).
// Exception (C1): one targeted describe block at the bottom mocks just
// enough of the data layer to assert the failure-trace wiring fires.

const selectQueue: unknown[][] = []
let txInsertedRows: Array<{ id: string }> = []
let txInsertedValues: Record<string, unknown> | null = null

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return {
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
          insert: () => ({
            values: (v: Record<string, unknown>) => {
              txInsertedValues = v
              return { returning: () => Promise.resolve(txInsertedRows) }
            },
          }),
        }
        return fn(tx)
      }),
    },
  }
})

vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
  inspectDominion: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  // Stand-in for the real bi-temporal gate — content doesn't matter here,
  // db.select is fully mocked below and never inspects the SQL it's given.
  validAsOfNow: 'mock-valid-as-of-now',
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

function makeCtx(overrides: Partial<CortexContext> = {}): CortexContext {
  return {
    dominionId: '11111111-1111-4111-8111-111111111111',
    name: 'AEON',
    vision: 'Fluid board/project app — morphism over rigidity.',
    missionLong: 'Ship closed beta exit by 2026-Q3.',
    objectives: [{ title: 'Magic link auth', description: null, status: 'open' }],
    boardTasks: [
      { name: 'finish DB migration', status: 'in_progress', priority: 'high', projectName: 'AS Sprint' },
    ],
    reflections: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Mobile is parked',
        summary: 'PWA via Capacitor is enough for beta',
        createdAt: new Date('2026-05-28'),
      },
    ],
    archetypes: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Kairos brain build-out',
        summary: 'Phase 1A shipped — partitioned brain, live board awareness.',
        themes: ['kairos', 'phase-1a'],
      },
    ],
    prior: null,
    ...overrides,
  }
}

const validPayload: CortexOutput = {
  visionAnchor: 'AEON is in the last 8 weeks of closed beta; the active centre of work is the Kairos brain build-out.',
  currentState: [
    'Kairos archetypes synthesise nightly per Dominion',
    'Mobile parked per reflection 2026-05-12',
  ],
  activeThreads: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Kairos brain build-out',
      pulse: 'high',
      lastAdvance: 'B1 shipped today',
    },
  ],
  driftSignals: ['Tauri desktop unchanged 60 days — still in scope?'],
  openQuestions: ['No archetype touches monetisation. Intentional?'],
  recentShifts: [],
}

describe('buildCortexPrompt', () => {
  it('includes vision, mission, objectives, board, reflections, archetypes, and prior snapshot', () => {
    const ctx = makeCtx({
      prior: {
        id: '44444444-4444-4444-8444-444444444444',
        createdAt: new Date('2026-06-01'),
        payload: validPayload,
      },
    })
    const prompt = buildCortexPrompt(ctx, '2026-06-02')

    expect(prompt).toContain('Dominion: "AEON"')
    expect(prompt).toContain('2026-06-02')
    expect(prompt).toContain('Fluid board/project app')
    expect(prompt).toContain('Ship closed beta exit')
    expect(prompt).toContain('Magic link auth')
    expect(prompt).toContain('finish DB migration')
    expect(prompt).toContain('Mobile is parked')
    expect(prompt).toContain('Kairos brain build-out')
    expect(prompt).toContain('snapshot from 2026-06-01')
    expect(prompt).toContain('Tauri desktop unchanged')
  })

  it('flags reflections as highest weight', () => {
    const prompt = buildCortexPrompt(makeCtx(), '2026-06-02')
    expect(prompt).toMatch(/Reflections carry HIGHER weight/i)
    expect(prompt).toMatch(/Owner reflections.*highest weight/i)
  })

  it('renders empty sections without crashing', () => {
    const prompt = buildCortexPrompt(
      makeCtx({
        objectives: [],
        boardTasks: [],
        reflections: [],
        archetypes: [],
        prior: null,
        vision: null,
        missionLong: null,
      }),
      '2026-06-02',
    )
    expect(prompt).toContain('(none set)')
    expect(prompt).toContain('(none open)')
    expect(prompt).toContain('(none yet)')
    expect(prompt).toContain('(no prior cortex — first regen)')
  })

  it('requests strict JSON output with the right shape', () => {
    const prompt = buildCortexPrompt(makeCtx(), '2026-06-02')
    expect(prompt).toContain('```json')
    expect(prompt).toContain('"visionAnchor"')
    expect(prompt).toContain('"currentState"')
    expect(prompt).toContain('"activeThreads"')
    expect(prompt).toContain('"driftSignals"')
    expect(prompt).toContain('"openQuestions"')
    expect(prompt).toContain('"recentShifts"')
  })

  it('escapes triple-backticks in reflection and archetype text', () => {
    const prompt = buildCortexPrompt(
      makeCtx({
        reflections: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            title: 'evil```json {"x":1}```',
            summary: null,
            createdAt: new Date('2026-06-01'),
          },
        ],
        archetypes: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            title: 'also ```bad```',
            summary: 'and ```worse``` here',
            themes: [],
          },
        ],
      }),
      '2026-06-02',
    )
    expect(prompt).not.toContain('evil```json')
    expect(prompt).not.toContain('also ```bad```')
    expect(prompt).toContain("evil'''json")
    expect(prompt).toContain("'''worse'''")
  })
})

describe('buildCortexPrompt — "Today so far" grounding (C)', () => {
  it('renders the section when todaySoFar is present', () => {
    const prompt = buildCortexPrompt(makeCtx({ todaySoFar: '3 new memories captured today.' }), '2026-06-02')
    expect(prompt).toContain('## Today so far')
    expect(prompt).toContain('3 new memories captured today.')
  })

  it('omits the section when todaySoFar is absent', () => {
    const prompt = buildCortexPrompt(makeCtx({ todaySoFar: null }), '2026-06-02')
    expect(prompt).not.toContain('## Today so far')
  })

  it('omits the section when todaySoFar is not set at all (back-compat fixture)', () => {
    const prompt = buildCortexPrompt(makeCtx(), '2026-06-02')
    expect(prompt).not.toContain('## Today so far')
  })

  it('keeps the system prompt byte-identical regardless of todaySoFar (cache rule)', () => {
    expect(CORTEX_SYSTEM_PROMPT).not.toContain('Today so far')
  })

  it('labels the section as the day being consolidated when todaySoFarDay is set', () => {
    const prompt = buildCortexPrompt(
      makeCtx({ todaySoFar: 'Shipped the eyes lane.', todaySoFarDay: '2026-09-29' }),
      '2026-09-30',
    )
    expect(prompt).toContain('## The day being consolidated (2026-09-29)')
    expect(prompt).not.toContain('## Today so far')
  })
})

describe('cortexGenSchema + groundCortexOutput (model-facing ids)', () => {
  const ARCH = '33333333-3333-4333-8333-333333333333'
  const thread = { title: 'Thread', pulse: 'steady', lastAdvance: 'moved' }

  it('accepts null / label / truncated ids that the stored schema rejects', () => {
    const raw = {
      ...validPayload,
      activeThreads: [{ ...thread, id: null }, { ...thread, id: 't1' }, { ...thread, id: '[33333333]' }],
    }
    expect(() => cortexOutSchema.parse(raw)).toThrow()
    const grounded = groundCortexOutput(cortexGenSchema.parse(raw), [ARCH])
    expect(grounded.activeThreads.map((t) => t.id)).toEqual([undefined, undefined, ARCH])
    expect(cortexOutSchema.parse(grounded).activeThreads).toHaveLength(3)
  })
})

describe('extractJsonBlock (cortex)', () => {
  it('parses a fenced ```json``` block', () => {
    expect(extractJsonBlock('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('falls back to first {...} when unfenced', () => {
    expect(extractJsonBlock('preamble {"b":2} trailing')).toEqual({ b: 2 })
  })

  it('throws when no JSON found', () => {
    expect(() => extractJsonBlock('plain text')).toThrow(/no JSON object/i)
  })
})

describe('cortexOutSchema', () => {
  it('accepts a minimal valid payload', () => {
    const parsed = cortexOutSchema.parse(validPayload)
    expect(parsed.currentState).toHaveLength(2)
    expect(parsed.activeThreads[0].pulse).toBe('high')
  })

  it('defaults activeThreads / driftSignals / openQuestions / recentShifts when omitted', () => {
    const minimal = {
      visionAnchor: 'a'.repeat(60),
      currentState: ['only this'],
    }
    const parsed = cortexOutSchema.parse(minimal)
    expect(parsed.activeThreads).toEqual([])
    expect(parsed.driftSignals).toEqual([])
    expect(parsed.openQuestions).toEqual([])
    expect(parsed.recentShifts).toEqual([])
  })

  it('rejects empty currentState', () => {
    expect(() =>
      cortexOutSchema.parse({ ...validPayload, currentState: [] }),
    ).toThrow()
  })

  it('rejects visionAnchor shorter than 20 chars', () => {
    expect(() =>
      cortexOutSchema.parse({ ...validPayload, visionAnchor: 'short' }),
    ).toThrow()
  })

  it('rejects unknown pulse value', () => {
    expect(() =>
      cortexOutSchema.parse({
        ...validPayload,
        activeThreads: [{ ...validPayload.activeThreads[0], pulse: 'frantic' }],
      }),
    ).toThrow()
  })
})

describe('renderCortexMarkdown', () => {
  it('renders all sections with vision anchor, threads, drift, questions, reflections', () => {
    const md = renderCortexMarkdown(
      makeCtx(),
      validPayload,
      '2026-06-02',
    )
    expect(md).toContain('# AEON — cortex (2026-06-02)')
    expect(md).toContain('## Vision anchor')
    expect(md).toContain(validPayload.visionAnchor)
    expect(md).toContain('## Current state')
    expect(md).toContain('## Active threads')
    expect(md).toContain('**[high]** Kairos brain build-out')
    expect(md).toContain('## Drift signals')
    expect(md).toContain('Tauri desktop')
    expect(md).toContain('## Open questions')
    expect(md).toContain('monetisation')
    expect(md).toContain('## Reflection trail')
    expect(md).toContain('Mobile is parked')
  })

  it('omits sections that are empty', () => {
    const md = renderCortexMarkdown(
      makeCtx({ reflections: [] }),
      {
        visionAnchor: 'a'.repeat(40),
        currentState: ['only the basics'],
        activeThreads: [],
        driftSignals: [],
        openQuestions: [],
        recentShifts: [],
      },
      '2026-06-02',
    )
    expect(md).not.toContain('## Active threads')
    expect(md).not.toContain('## Drift signals')
    expect(md).not.toContain('## Open questions')
    expect(md).not.toContain('## Recent shifts')
    expect(md).not.toContain('## Reflection trail')
  })

  it('renders recentShifts when populated', () => {
    const md = renderCortexMarkdown(
      makeCtx(),
      { ...validPayload, recentShifts: ['Briefer became board-aware'] },
      '2026-06-02',
    )
    expect(md).toContain('## Recent shifts')
    expect(md).toContain('Briefer became board-aware')
  })
})

// Heavier DB-mocked tests than the pure-function suite above; give them
// headroom so they don't flake on the default 5s timeout under full-suite load.
describe('runCortexRegenForDominion — failure trace (C1)', { timeout: 20000 }, () => {
  const USER_ID = 'user-1'
  const DOMINION_ID = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    txInsertedRows = []
  })

  it('writes a failure trace on empty model response', async () => {
    const { inspectDominion } = await import('@/lib/data/dominions')
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')

    selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }]) // dominion lookup
    selectQueue.push([{ n: 0 }]) // alreadyRanToday
    vi.mocked(inspectDominion).mockResolvedValueOnce({
      name: 'AEON',
      // vision (not reflections/boardTasks) satisfies hasSignal without
      // tripping the "archetypes not synthesised today" race-defense skip,
      // which fires whenever there's activity signal but zero archetypes.
      vision: 'Fluid board/project app.',
      missionLong: null,
      objectives: [],
      boardTasks: [],
    } as never)
    selectQueue.push([]) // reflections
    selectQueue.push([]) // archetypes
    selectQueue.push([]) // prior
    selectQueue.push([]) // todaySoFar: latest delta memory — none
    selectQueue.push([{ n: 0 }]) // todaySoFar: fallback new-memory count — zero
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask: vi.fn().mockResolvedValue({ text: '' }) } } as never)

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('error')
    expect(result.reason).toBe('empty model response')
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(1)
    const sm = (traceCalls[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm.cronName).toBe('cortex-regen')
    expect(sm.reason).toBe('empty_response')
  })

  function queueDominionAndContext() {
    selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }]) // dominion lookup
    selectQueue.push([{ n: 0 }]) // alreadyRanToday
    selectQueue.push([]) // reflections
    selectQueue.push([]) // archetypes
    selectQueue.push([]) // prior
    selectQueue.push([]) // todaySoFar: latest delta memory — none
    selectQueue.push([{ n: 0 }]) // todaySoFar: fallback new-memory count — zero
  }

  async function mockInspectDominionWithVision() {
    const { inspectDominion } = await import('@/lib/data/dominions')
    vi.mocked(inspectDominion).mockResolvedValueOnce({
      name: 'AEON',
      vision: 'Fluid board/project app.',
      missionLong: null,
      objectives: [],
      boardTasks: [],
    } as never)
  }

  it('repairs malformed JSON on the second attempt and creates a cortex row (T-A1)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithVision()

    // Embedded unescaped quote mid-array reproduces the real prod signature:
    // `Expected ',' or ']' after array element`.
    const malformed = '{"visionAnchor":"AEON is deep in Kairos build-out.","currentState":["a "quoted" fragment breaks this array"]}'
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: malformed })
      .mockResolvedValueOnce({ text: JSON.stringify(validPayload) })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
    txInsertedRows = [{ id: 'cortex-mem-1' }]

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(ask).toHaveBeenCalledTimes(2)
    const traceMeta = vi.mocked(captureMemory).mock.calls
      .filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
      .map((c) => (c[1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata)
    expect(traceMeta.filter((m) => m.reason !== undefined)).toHaveLength(0)
    expect(traceMeta).toContainEqual(expect.objectContaining({ cronName: 'cortex-regen', outcome: 'ok' }))
  })

  it('writes exactly one failure trace when both parse attempts fail (T-A2)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithVision()

    const ask = vi.fn().mockResolvedValue({ text: 'not json at all' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/^parse_failed:/)
    expect(result.reason).toContain('repair also failed')
    expect(ask).toHaveBeenCalledTimes(2)
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(1)
    const sm = (traceCalls[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm.reason).toBe('parse_failed:syntax')
  })

  it('repairs a zod-boundary schema violation, not just JSON syntax errors (T-A3)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithVision()

    // Structurally valid JSON, but currentState[0] is 281 chars — one over
    // cortexOutSchema's max(280) — so this fails zod, not extractJsonBlock.
    const overLong = { ...validPayload, currentState: ['a'.repeat(281)] }
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(overLong) })
      .mockResolvedValueOnce({ text: JSON.stringify(validPayload) })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
    txInsertedRows = [{ id: 'cortex-mem-2' }]

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(ask).toHaveBeenCalledTimes(2)
    const traceMeta = vi.mocked(captureMemory).mock.calls
      .filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
      .map((c) => (c[1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata)
    expect(traceMeta.filter((m) => m.reason !== undefined)).toHaveLength(0)
    expect(traceMeta).toContainEqual(expect.objectContaining({ cronName: 'cortex-regen', outcome: 'ok' }))
  })

  it('records finishReason on the trace when the model truncates (T-A4)', async () => {
    const { captureMemory } = await import('@/lib/data/memories')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    queueDominionAndContext()
    await mockInspectDominionWithVision()

    const ask = vi.fn().mockResolvedValue({ text: '{"visionAnchor":"truncated mid-array', finishReason: 'length' })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('error')
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(1)
    const sm = (traceCalls[0][1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata
    expect(sm.finishReason).toBe('length')
    expect(typeof sm.rawExcerpt).toBe('string')
  })
})

describe('gatherCortexContext — day-being-consolidated grounding', () => {
  const USER_ID = 'user-1'
  const DOMINION_ID = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    // Only Date is faked so the async mock chain still resolves normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T03:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mockBriefingWithVision() {
    const { inspectDominion } = await import('@/lib/data/dominions')
    vi.mocked(inspectDominion).mockResolvedValueOnce({
      name: 'AEON',
      vision: 'Fluid board/project app.',
      missionLong: null,
      objectives: [],
      boardTasks: [],
    } as never)
  }

  function queueInputs() {
    selectQueue.push([]) // reflections
    selectQueue.push([]) // archetypes
    selectQueue.push([]) // prior
  }

  it('previousUtcDay steps back one UTC calendar day, across month edges', async () => {
    const { previousUtcDay } = await import('../cortex')
    expect(previousUtcDay('2026-09-30')).toBe('2026-09-29')
    expect(previousUtcDay('2026-10-01')).toBe('2026-09-30')
    expect(previousUtcDay('2026-01-01')).toBe('2025-12-31')
  })

  it('at 03:00Z reads the previous UTC day and labels it as the day being consolidated', async () => {
    await mockBriefingWithVision()
    queueInputs()
    selectQueue.push([{ bodyMd: 'Kairos shipped micro-consolidation.' }]) // deltas for 2026-09-29

    const { gatherCortexContext } = await import('../cortex')
    const ctx = await gatherCortexContext(USER_ID, DOMINION_ID)

    expect(ctx?.todaySoFar).toBe('Kairos shipped micro-consolidation.')
    expect(ctx?.todaySoFarDay).toBe('2026-09-29')
  })

  it("joins the day's deltas oldest-first (query returns newest-first)", async () => {
    await mockBriefingWithVision()
    queueInputs()
    selectQueue.push([{ bodyMd: 'evening fold' }, { bodyMd: 'morning fold' }])

    const { gatherCortexContext } = await import('../cortex')
    const ctx = await gatherCortexContext(USER_ID, DOMINION_ID)

    expect(ctx?.todaySoFar).toBe('morning fold\n\n---\n\nevening fold')
  })

  it('falls back to a dated singular count when no delta landed that day', async () => {
    await mockBriefingWithVision()
    queueInputs()
    selectQueue.push([]) // deltas — none
    selectQueue.push([{ n: 1 }]) // fallback count

    const { gatherCortexContext } = await import('../cortex')
    const ctx = await gatherCortexContext(USER_ID, DOMINION_ID)

    expect(ctx?.todaySoFar).toBe('1 new memory captured on 2026-09-29.')
  })

  it('falls back to a dated plural count, and omits the day label when empty', async () => {
    await mockBriefingWithVision()
    queueInputs()
    selectQueue.push([])
    selectQueue.push([{ n: 4 }])

    const { gatherCortexContext } = await import('../cortex')
    const ctx = await gatherCortexContext(USER_ID, DOMINION_ID)
    expect(ctx?.todaySoFar).toBe('4 new memories captured on 2026-09-29.')

    await mockBriefingWithVision()
    queueInputs()
    selectQueue.push([])
    selectQueue.push([{ n: 0 }])
    const empty = await gatherCortexContext(USER_ID, DOMINION_ID)
    expect(empty?.todaySoFar).toBeNull()
    expect(empty?.todaySoFarDay).toBeNull()
  })
})

describe('runCortexRegenForDominion — grounded ids + liveness', { timeout: 20000 }, () => {
  const USER_ID = 'user-1'
  const DOMINION_ID = '11111111-1111-4111-8111-111111111111'
  const ARCH_ID = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    txInsertedRows = []
    txInsertedValues = null
  })

  async function traceMeta() {
    const { captureMemory } = await import('@/lib/data/memories')
    return vi.mocked(captureMemory).mock.calls
      .filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
      .map((c) => (c[1] as { sourceMetadata: Record<string, unknown> }).sourceMetadata)
  }

  it('persists a cortex whose threads carried null / label / unknown ids, keeping only the real archetype id', async () => {
    const { inspectDominion } = await import('@/lib/data/dominions')
    const { getProviderForTask } = await import('@/lib/ai/route-task')
    selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }])
    selectQueue.push([{ n: 0 }]) // alreadyRanToday
    vi.mocked(inspectDominion).mockResolvedValueOnce({
      name: 'AEON', vision: 'Fluid board/project app.', missionLong: null, objectives: [], boardTasks: [],
    } as never)
    selectQueue.push([]) // reflections
    selectQueue.push([{ id: ARCH_ID, title: 'Kairos brain', summary: null, sourceMetadata: { themes: [] } }])
    selectQueue.push([]) // prior
    selectQueue.push([]) // deltas
    selectQueue.push([{ n: 0 }]) // fallback count

    const thread = { title: 'Thread', pulse: 'high', lastAdvance: 'moved' }
    const modelOut = {
      ...validPayload,
      activeThreads: [
        { ...thread, id: null },
        { ...thread, id: 't1' },
        { ...thread, id: '99999999-9999-4999-8999-999999999999' },
        { ...thread, id: ARCH_ID.toUpperCase() },
      ],
    }
    const ask = vi.fn().mockResolvedValue({ text: JSON.stringify(modelOut) })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
    txInsertedRows = [{ id: 'cortex-mem-9' }]

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('created')
    expect(ask).toHaveBeenCalledTimes(1)
    const stored = (txInsertedValues?.sourceMetadata as { cortex: CortexOutput }).cortex
    expect(stored.activeThreads.map((t) => t.id)).toEqual([undefined, undefined, undefined, ARCH_ID])
    expect(cortexOutSchema.safeParse(stored).success).toBe(true)
    const meta = await traceMeta()
    expect(meta).toEqual([expect.objectContaining({ cronName: 'cortex-regen', outcome: 'ok' })])
  })

  it('writes a skipped liveness trace when the Dominion already ran today', async () => {
    selectQueue.push([{ id: DOMINION_ID, name: 'AEON', archivedAt: null }])
    selectQueue.push([{ n: 1 }]) // alreadyRanToday

    const { runCortexRegenForDominion } = await import('../cortex')
    const result = await runCortexRegenForDominion(USER_ID, DOMINION_ID)

    expect(result.status).toBe('existing')
    expect(await traceMeta()).toEqual([
      expect.objectContaining({ cronName: 'cortex-regen', outcome: 'skipped', skipReason: 'already ran today' }),
    ])
  })
})