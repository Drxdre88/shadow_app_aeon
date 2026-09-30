import { describe, it, expect } from 'vitest'
import {
  buildAetherPrompt,
  extractJsonBlock,
  aetherOutSchema,
  aetherGenSchema,
  aetherFedMemoryIds,
  groundAetherPayload,
  previousUtcDay,
  AETHER_SYSTEM_PROMPT,
  renderAetherMarkdown,
  type AetherContext,
} from '../aether-prompt'
import type { AetherPayload } from '../aether-types'

// Pure-function tests only, mirroring archetypes.test.ts / cortex.test.ts —
// the DB-touching runAetherForUser path is covered separately in aether.test.ts.

function makeCtx(overrides: Partial<AetherContext> = {}): AetherContext {
  return {
    userId: 'user-1',
    today: '2026-07-08',
    cortexSnapshots: [],
    topReflections: [],
    archetypes: [],
    prior: null,
    ...overrides,
  }
}

describe('buildAetherPrompt', () => {
  it('renders empty sections without crashing on a minimal context', () => {
    const prompt = buildAetherPrompt(makeCtx())
    expect(prompt).toContain('2026-07-08')
    expect(prompt).toContain('(no Dominion cortex available')
    expect(prompt).toContain('(none yet)')
    expect(prompt).toContain('(none)')
    expect(prompt).toContain('(no prior aether — first run)')
  })

  it('includes cortex snapshots, reflections, archetypes, and prior aether when present', () => {
    const prompt = buildAetherPrompt(makeCtx({
      cortexSnapshots: [{
        id: '11111111-1111-4111-8111-111111111111',
        dominionId: '22222222-2222-4222-8222-222222222222',
        dominionName: 'AEON',
        dominionColor: 'purple',
        createdAt: new Date('2026-07-07'),
        visionAnchor: 'Fluid board/project app.',
        currentState: ['shipping favorites'],
        driftSignals: ['mobile parked'],
      }],
      topReflections: [{
        id: '33333333-3333-4333-8333-333333333333',
        dominionId: null,
        dominionName: null,
        title: 'Owner reflection',
        summary: 'A signal worth weighting highly.',
        createdAt: new Date('2026-07-06'),
      }],
      archetypes: [{
        id: '44444444-4444-4444-8444-444444444444',
        dominionId: '22222222-2222-4222-8222-222222222222',
        dominionName: 'AEON',
        title: 'Kairos brain build-out',
        summary: 'Phase 1A shipped.',
        themes: ['kairos'],
      }],
      prior: {
        id: '55555555-5555-4555-8555-555555555555',
        createdAt: new Date('2026-07-05'),
        payload: {
          generatedAt: '2026-07-05T00:00:00.000Z',
          coreNarrative: 'Yesterday narrative.',
          thoughts: [],
          tensions: [],
          shifts: ['moved from A to B'],
        },
      },
    }))

    expect(prompt).toContain('Fluid board/project app')
    expect(prompt).toContain('Owner reflection')
    expect(prompt).toContain('Kairos brain build-out')
    expect(prompt).toContain('moved from A to B')
    expect(prompt).toMatch(/Reflections carry HIGHER weight/)
  })

  it('requests strict fenced JSON output with the aether schema shape', () => {
    const prompt = buildAetherPrompt(makeCtx())
    expect(prompt).toContain('```json')
    expect(prompt).toContain('"coreNarrative"')
    expect(prompt).toContain('"thoughts"')
    expect(prompt).toContain('"sourceMemoryIds"')
  })
})

describe('buildAetherPrompt — day-being-consolidated grounding', () => {
  it('renders the section labelled with the PREVIOUS UTC day', () => {
    const prompt = buildAetherPrompt(makeCtx({ todaySoFar: '5 new memories captured on 2026-07-07 across all Dominions.' }))
    expect(prompt).toContain('## Day being consolidated (2026-07-07)')
    expect(prompt).toContain('5 new memories captured on 2026-07-07 across all Dominions.')
    expect(prompt).not.toContain('## Today so far')
  })

  it('omits the section when todaySoFar is absent', () => {
    const prompt = buildAetherPrompt(makeCtx({ todaySoFar: null }))
    expect(prompt).not.toContain('## Day being consolidated')
  })

  it('omits the section when todaySoFar is not set at all (back-compat fixture)', () => {
    const prompt = buildAetherPrompt(makeCtx())
    expect(prompt).not.toContain('## Day being consolidated')
  })

  it('keeps the system prompt byte-identical regardless of todaySoFar (cache rule)', () => {
    expect(AETHER_SYSTEM_PROMPT).not.toContain('Day being consolidated')
  })

  it('previousUtcDay crosses month and year boundaries', () => {
    expect(previousUtcDay('2026-03-01')).toBe('2026-02-28')
    expect(previousUtcDay('2027-01-01')).toBe('2026-12-31')
  })
})

describe('AETHER_SYSTEM_PROMPT — id contract (A2)', () => {
  it('asks for short thought labels and forbids invented UUIDs', () => {
    expect(AETHER_SYSTEM_PROMPT).toContain('Never invent UUIDs')
    expect(AETHER_SYSTEM_PROMPT).toContain('"id": "t1"')
    expect(AETHER_SYSTEM_PROMPT).not.toMatch(/UUID v4/)
  })
})

describe('aetherGenSchema + groundAetherPayload', () => {
  const MEM_A = '22222222-2222-4222-8222-222222222222'
  const MEM_B = '44444444-4444-4444-8444-444444444444'
  const genThought = (id: string, sourceMemoryIds: string[]) => ({
    id,
    title: 'Focus',
    insight: 'A sufficiently long insight paragraph for schema validation purposes here.',
    salience: 0.5,
    kind: 'connection',
    sourceMemoryIds,
    ageDays: 1,
  })
  const gen = (thoughts: unknown[], tensions: unknown[] = []) => aetherGenSchema.parse({
    generatedAt: '2026-07-08T00:00:00.000Z',
    coreNarrative: 'A grounded narrative spanning at least twenty characters.',
    thoughts,
    tensions,
  })
  const minted = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

  it('accepts short labels and non-RFC ids that aetherOutSchema rejects', () => {
    const payload = {
      generatedAt: 'x',
      coreNarrative: 'A grounded narrative spanning twenty chars.',
      thoughts: [genThought('12345678-1234-1234-0234-123456789abc', [MEM_A])],
    }
    expect(aetherGenSchema.safeParse(payload).success).toBe(true)
    expect(aetherOutSchema.safeParse(payload).success).toBe(false)
  })

  it('mints UUIDs, remaps tensions, drops dangling/self tensions, and satisfies aetherOutSchema', () => {
    let n = 0
    const out = groundAetherPayload(gen(
      [genThought('t1', [MEM_A]), genThought('t2', [MEM_B])],
      [
        { aId: 't1', bId: 't2', note: 'kept' },
        { aId: 't1', bId: 'ghost', note: 'dangling' },
        { aId: 't2', bId: 't2', note: 'self' },
      ],
    ), new Set([MEM_A, MEM_B]), () => minted(++n))

    expect(out.thoughts.map((t) => t.id)).toEqual([minted(1), minted(2)])
    expect(out.tensions).toEqual([{ aId: minted(1), bId: minted(2), note: 'kept' }])
    expect(aetherOutSchema.safeParse(out).success).toBe(true)
  })

  it('grounds citations against the fed set and drops thoughts left uncited (and their tensions)', () => {
    const out = groundAetherPayload(gen(
      [genThought('t1', [MEM_A, MEM_B, MEM_A]), genThought('t2', [MEM_B])],
      [{ aId: 't1', bId: 't2', note: 'orphaned' }],
    ), new Set([MEM_A]))

    expect(out.thoughts).toHaveLength(1)
    expect(out.thoughts[0].sourceMemoryIds).toEqual([MEM_A])
    expect(out.tensions).toEqual([])
  })

  it('without a fed set (MCP commit), keeps only well-formed UUID citations', () => {
    const out = groundAetherPayload(gen([genThought('t1', [MEM_A, 'r1']), genThought('t2', ['r2'])]))
    expect(out.thoughts).toHaveLength(1)
    expect(out.thoughts[0].sourceMemoryIds).toEqual([MEM_A])
  })

  it('aetherFedMemoryIds collects cortex, reflection, and archetype ids', () => {
    const ids = aetherFedMemoryIds({
      cortexSnapshots: [{ id: 'c1' } as never],
      topReflections: [{ id: 'r1' } as never],
      archetypes: [{ id: 'a1' } as never],
    })
    expect([...ids].sort()).toEqual(['a1', 'c1', 'r1'])
  })
})

describe('extractJsonBlock (aether)', () => {
  it('parses a fenced ```json``` block', () => {
    expect(extractJsonBlock('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('falls back to the first {...} span with no fence present', () => {
    expect(extractJsonBlock('preamble {"k": 1} trailing')).toEqual({ k: 1 })
  })

  it('throws a labelled error on truncated JSON (no closing brace)', () => {
    expect(() => extractJsonBlock('```json\n{"a": 1, "b": [1, 2')).toThrow(/no JSON object/i)
  })

  it('throws a labelled error on malformed JSON', () => {
    expect(() => extractJsonBlock('```json\n{"a": 1,}\n```')).toThrow(/aether generator: malformed JSON/i)
  })
})

describe('aetherOutSchema', () => {
  const validThought = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Focus',
    insight: 'A sufficiently long insight paragraph for schema validation purposes here.',
    dominionId: null,
    dominionName: null,
    dominionColor: null,
    salience: 0.7,
    kind: 'conclusion',
    sourceMemoryIds: ['22222222-2222-4222-8222-222222222222'],
    ageDays: 3,
  }

  const validPayload = {
    generatedAt: '2026-07-08T00:00:00.000Z',
    coreNarrative: 'A grounded narrative spanning at least twenty characters.',
    thoughts: [validThought],
  }

  it('accepts a minimal valid payload and defaults tensions/shifts', () => {
    const parsed = aetherOutSchema.parse(validPayload)
    expect(parsed.thoughts).toHaveLength(1)
    expect(parsed.tensions).toEqual([])
    expect(parsed.shifts).toEqual([])
  })

  it('rejects a thought with empty sourceMemoryIds', () => {
    expect(() =>
      aetherOutSchema.parse({
        ...validPayload,
        thoughts: [{ ...validThought, sourceMemoryIds: [] }],
      }),
    ).toThrow()
  })

  it('rejects an empty thoughts array', () => {
    expect(() => aetherOutSchema.parse({ ...validPayload, thoughts: [] })).toThrow()
  })

  it('rejects more than 20 thoughts', () => {
    const many = Array.from({ length: 21 }, () => validThought)
    expect(() => aetherOutSchema.parse({ ...validPayload, thoughts: many })).toThrow()
  })
})

describe('renderAetherMarkdown', () => {
  const payload: AetherPayload = {
    generatedAt: '2026-07-08T00:00:00.000Z',
    coreNarrative: 'The operator is building a fluid board app across several Dominions.',
    thoughts: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Velocity',
        insight: 'Shipping is accelerating across the beta.',
        dominionId: null,
        dominionName: 'AEON',
        dominionColor: 'purple',
        salience: 0.9,
        kind: 'eureka',
        sourceMemoryIds: ['22222222-2222-4222-8222-222222222222'],
        ageDays: 1,
      },
    ],
    tensions: [{ aId: '11111111-1111-4111-8111-111111111111', bId: '33333333-3333-4333-8333-333333333333', note: 'competing priorities' }],
    shifts: ['moved from exploration to shipping'],
  }

  it('renders core narrative, kind sections, tensions, and shifts', () => {
    const md = renderAetherMarkdown(payload, '2026-07-08')
    expect(md).toContain('# Aether — global self-model (2026-07-08)')
    expect(md).toContain('## Core narrative')
    expect(md).toContain('## Eurekas')
    expect(md).toContain('Velocity')
    expect(md).toContain('## Cross-cutting tensions')
    expect(md).toContain('competing priorities')
    expect(md).toContain('## Shifts since prior Aether')
    expect(md).toContain('moved from exploration to shipping')
  })

  it('omits kind sections and tension/shift headings when empty', () => {
    const md = renderAetherMarkdown({ ...payload, thoughts: [], tensions: [], shifts: [] }, '2026-07-08')
    expect(md).not.toContain('## Eurekas')
    expect(md).not.toContain('## Cross-cutting tensions')
    expect(md).not.toContain('## Shifts since prior Aether')
  })
})
