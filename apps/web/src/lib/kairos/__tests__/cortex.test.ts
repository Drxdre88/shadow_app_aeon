import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildCortexPrompt,
  CORTEX_SYSTEM_PROMPT,
  cortexOutSchema,
  extractJsonBlock,
  renderCortexMarkdown,
  type CortexContext,
  type CortexOutput,
} from '../cortex-prompt'

// Pure-function tests only below (see archetypes.test.ts for rationale).
// Exception (C1): one targeted describe block at the bottom mocks just
// enough of the data layer to assert the failure-trace wiring fires.

const selectQueue: unknown[][] = []
let txInsertedRows: Array<{ id: string }> = []

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
          insert: () => ({ values: () => ({ returning: () => Promise.resolve(txInsertedRows) }) }),
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
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(0)
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
    const traceCalls = vi.mocked(captureMemory).mock.calls.filter((c) => (c[1] as { streamClass?: string }).streamClass === 'trace')
    expect(traceCalls).toHaveLength(0)
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
