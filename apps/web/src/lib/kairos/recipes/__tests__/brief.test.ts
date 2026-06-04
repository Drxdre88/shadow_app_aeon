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
    expect(BRIEF.expanded).toBeUndefined()
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
      temperature: 0.4,
    }))
  })
})
