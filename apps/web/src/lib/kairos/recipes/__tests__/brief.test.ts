import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

import { BRIEF } from '../brief'
import { getProviderForTask } from '@/lib/ai/route-task'
import type { RecipeContext } from '../_recipe'

const USER_ID = 'user-1'
const DOMINION_ID = 'b0000000-0000-4000-8000-000000000002'

function fakeBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: DOMINION_ID,
    userId: USER_ID,
    name: 'Test Dominion',
    summary: null,
    vision: 'be excellent',
    missionLong: 'do the thing',
    objectives: [{ title: 'Ship 3C', description: null, status: 'in_progress' }],
    projects: [{ id: 'p1', name: 'Alpha' }],
    recentMemories: [{ title: 'note', type: 'note', summary: null }],
    boardTasks: [],
    archivedAt: null,
    ...overrides,
  }
}

function ctx(retrieval: Record<string, unknown>): RecipeContext {
  return {
    userId: USER_ID,
    dominionId: DOMINION_ID,
    args: {},
    retrieval: {
      bundle: null,
      cortex: null,
      archetypes: [],
      substrate: [],
      traces: [],
      ...retrieval,
    } as RecipeContext['retrieval'],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BRIEF recipe', () => {
  it('descriptor surfaces the right reads/writes/name', () => {
    expect(BRIEF.name).toBe('BRIEF')
    expect(BRIEF.writes).toEqual(['advisory'])
    expect(BRIEF.reads).toContain('reflection')
    expect(BRIEF.reads).toEqual(expect.arrayContaining(['cortex', 'aether', 'belief', 'constitution']))
    expect(BRIEF.expanded).toBeUndefined()
  })

  it('reads the Dominion cortex, a short Aether digest and the conscience block; format unchanged', async () => {
    const ask = vi.fn(async () => ({ text: 'ok', modelId: 'm' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    const thought = (id: string, dominionId: string | null, salience: number) => ({
      id, title: `T-${id}`, insight: `insight ${id}`, dominionId, dominionName: dominionId ? 'Test Dominion' : null,
      dominionColor: null, salience, kind: 'tension' as const, sourceMemoryIds: [], ageDays: 1,
    })
    const c: RecipeContext = {
      ...ctx({
        bundle: fakeBundle(),
        cortex: { id: 'cx1', title: 'Cortex today', body: 'Momentum on ```Alpha```', streamClass: 'cortex', createdAt: new Date() },
      }),
      grounding: {
        aether: {
          generatedAt: '2026-10-01T00:00:00Z',
          coreNarrative: 'Building while tired.',
          thoughts: [thought('a', DOMINION_ID, 0.2), thought('b', 'other-dom', 0.99), thought('c', null, 0.9), thought('d', DOMINION_ID, 0.5)],
          tensions: [{ aId: 'a', bId: 'c', note: 'speed vs rest' }],
          shifts: [],
        },
        conscience: '## Conscience (reference data)\n1. Rest on Sundays',
      },
    }
    const out = await BRIEF.flat(c)
    const prompt = promptFrom(ask)
    expect(prompt).toContain('## Dominion cortex')
    expect(prompt).toContain('Momentum on \'\'\'Alpha\'\'\'') // fences neutralised
    expect(prompt).toContain('Building while tired.')
    expect(prompt).toContain('- Tension: T-a ↔ T-c: speed vs rest')
    // This Dominion's threads first, then cross-cutting; other Dominions excluded.
    const threads = prompt.split('\n').filter((l) => l.startsWith('- Thread'))
    expect(threads.map((l) => l.match(/T-(\w)/)?.[1])).toEqual(['d', 'a', 'c'])
    expect(prompt).toContain('## Conscience (reference data)\n1. Rest on Sundays')
    // Grounding comes after the live snapshot; system prompt keeps the format.
    expect(prompt.indexOf('## Open board cards')).toBeLessThan(prompt.indexOf('## Dominion cortex'))
    const req = (ask.mock.calls as unknown as Array<[{ system: string }]>)[0][0]
    expect(req.system).toContain('── OUTPUT FORMAT ──')
    expect(req.system).toContain('No preamble. Start directly with `## State`')
    expect(out.traceMeta.grounding).toEqual({ cortex: true, aether: true, conscience: true })
  })

  it('omits grounding sections when the dispatcher supplied none', async () => {
    const ask = vi.fn(async () => ({ text: 'ok', modelId: 'm' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    const out = await BRIEF.flat(ctx({ bundle: fakeBundle() }))
    const prompt = promptFrom(ask)
    expect(prompt).not.toContain('## Dominion cortex')
    expect(prompt).not.toContain('## Aether')
    expect(prompt).not.toContain('Conscience')
    expect(out.traceMeta.grounding).toEqual({ cortex: false, aether: false, conscience: false })
  })

  it('throws when retrieval bundle is missing', async () => {
    await expect(BRIEF.flat(ctx({ bundle: null }))).rejects.toThrow(/no Dominion bundle/)
  })

  it('throws when provider returns empty text', async () => {
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: { ask: vi.fn(async () => ({ text: '   ', modelId: 'm' })) },
    })
    await expect(BRIEF.flat(ctx({ bundle: fakeBundle() }))).rejects.toThrow(/empty response/)
  })

  it('returns an advisory primary with the expected idempotency key + title', async () => {
    const ask = vi.fn(async () => ({ text: 'briefing body markdown', modelId: 'sonnet-test' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })

    const out = await BRIEF.flat(ctx({ bundle: fakeBundle() }))
    const date = new Date().toISOString().slice(0, 10)

    expect(out.primary.type).toBe('advisory')
    expect(out.primary.streamClass).toBe('advisory')
    expect(out.primary.source).toBe('cron')
    expect(out.primary.title).toBe(`${date} · Test Dominion briefing`)
    expect(out.primary.bodyMd).toBe('briefing body markdown')
    expect(out.primary.dominionId).toBe(DOMINION_ID)
    const meta = out.primary.sourceMetadata as Record<string, unknown>
    expect(meta.externalId).toBe(`briefer:${date}:${DOMINION_ID}`)
    expect(meta.briefingDate).toBe(date)
    expect(meta.dominionId).toBe(DOMINION_ID)
    expect(out.traceMeta.date).toBe(date)
    expect(out.traceMeta.model).toBe('sonnet-test')

    expect(getProviderForTask).toHaveBeenCalledWith(USER_ID, { taskType: 'brief', dominionId: DOMINION_ID })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      maxTokens: 1200,
      cacheSystem: true,
      system: expect.stringContaining('── OUTPUT FORMAT ──'),
    }))
  })

  it('renders "(none)" for empty objectives in the prompt', async () => {
    const ask = vi.fn(async () => ({ text: 'ok', modelId: 'm' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    await BRIEF.flat(ctx({ bundle: fakeBundle({ objectives: [] }) }))
    const prompt = promptFrom(ask)
    expect(prompt).toMatch(/## Open objectives\n\(none\)/)
  })

  it('caps recentMemories rendering at 15 entries even when bundle has more', async () => {
    const ask = vi.fn(async () => ({ text: 'ok', modelId: 'm' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    const many = Array.from({ length: 25 }, (_, i) => ({
      title: `mem-${i}`,
      type: 'note',
      summary: null,
    }))
    await BRIEF.flat(ctx({ bundle: fakeBundle({ recentMemories: many }) }))
    const prompt = promptFrom(ask)
    // Pull the section between "## Recent memories" and the next "##" header.
    const section = prompt.split('## Recent memories\n')[1].split('\n##')[0]
    const bullets = section.split('\n').filter((l) => l.startsWith('- '))
    expect(bullets).toHaveLength(15)
    expect(bullets[0]).toContain('mem-0')
    expect(bullets[14]).toContain('mem-14')
  })

  it('formats boardTask endDate as ISO YYYY-MM-DD in the prompt', async () => {
    const ask = vi.fn(async () => ({ text: 'ok', modelId: 'm' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    const due = new Date('2026-07-01T15:30:00Z')
    await BRIEF.flat(ctx({
      bundle: fakeBundle({
        boardTasks: [{ name: 'Ship 3D', status: 'todo', priority: 'high', projectName: 'Aeon', endDate: due }],
      }),
    }))
    const prompt = promptFrom(ask)
    expect(prompt).toMatch(/Ship 3D due 2026-07-01/)
  })

  it('renders "(none open)" for empty boardTasks', async () => {
    const ask = vi.fn(async () => ({ text: 'ok', modelId: 'm' }))
    ;(getProviderForTask as ReturnType<typeof vi.fn>).mockResolvedValue({ provider: { ask } })
    await BRIEF.flat(ctx({ bundle: fakeBundle({ boardTasks: [] }) }))
    const prompt = promptFrom(ask)
    expect(prompt).toMatch(/## Open board cards \(live\)\n\(none open\)/)
  })
})

function promptFrom(ask: ReturnType<typeof vi.fn>): string {
  const calls = ask.mock.calls as Array<Array<{ prompt?: string }>>
  return String(calls[0]?.[0]?.prompt ?? '')
}
