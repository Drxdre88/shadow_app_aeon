import { describe, it, expect } from 'vitest'
import {
  buildCortexPrompt,
  cortexOutSchema,
  extractJsonBlock,
  renderCortexMarkdown,
  type CortexContext,
  type CortexOutput,
} from '../cortex-prompt'

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

    expect(prompt).toContain('"AEON" Dominion')
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
