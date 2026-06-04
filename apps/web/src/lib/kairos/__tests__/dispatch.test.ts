import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

vi.mock('../retrieve', () => ({
  retrieveContext: vi.fn(),
}))

vi.mock('../recipes/registry', () => ({
  getRecipe: vi.fn(),
}))

import { runRecipe, RecipeNotFoundError } from '../dispatch'
import { captureMemory } from '@/lib/data/memories'
import { retrieveContext } from '../retrieve'
import { getRecipe } from '../recipes/registry'
import type { Recipe, RecipeContext, RecipeOutput } from '../recipes/_recipe'

const USER_ID = 'user-1'
const DOMINION_ID = 'b0000000-0000-4000-8000-000000000002'

function fakeRecipe(name = 'TEST'): Recipe {
  const flat: (ctx: RecipeContext) => Promise<RecipeOutput> = async (ctx) => ({
    primary: {
      type: 'advisory',
      streamClass: 'advisory',
      source: 'cron',
      title: `${name} primary`,
      bodyMd: 'hello',
      dominionId: ctx.dominionId,
      sourceMetadata: { externalId: `${name}:once` },
    },
    traceMeta: { foo: 'bar' },
  })
  return {
    name,
    description: 'test recipe',
    reads: ['cortex'],
    writes: ['advisory'],
    flat: vi.fn(flat),
  }
}

const EMPTY_RETRIEVAL = {
  bundle: null,
  cortex: null,
  archetypes: [],
  substrate: [],
  traces: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(retrieveContext as ReturnType<typeof vi.fn>).mockResolvedValue(EMPTY_RETRIEVAL)
})

describe('runRecipe', () => {
  it('throws RecipeNotFoundError when registry returns null', async () => {
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(null)
    await expect(runRecipe('NOPE', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' }))
      .rejects.toBeInstanceOf(RecipeNotFoundError)
  })

  it('writes primary + trace and returns status=created', async () => {
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(fakeRecipe())
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'primary-1', title: 'TEST primary' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 'trace-1', title: 'trace' }, created: true })

    const result = await runRecipe('TEST', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' })

    expect(result).toEqual({ status: 'created', memoryId: 'primary-1', traceId: 'trace-1' })
    expect(captureMemory).toHaveBeenCalledTimes(2)

    const traceCall = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[1]
    const traceInput = traceCall[1] as Record<string, unknown>
    expect(traceInput.streamClass).toBe('trace')
    expect(traceInput.type).toBe('session_event')
    expect(traceInput.source).toBe('system')
    const traceMeta = traceInput.sourceMetadata as Record<string, unknown>
    expect(traceMeta.primaryMemoryId).toBe('primary-1')
    expect(traceMeta.recipe).toBe('TEST')
    expect(traceMeta.mode).toBe('flat')
    expect(traceMeta.foo).toBe('bar')
  })

  it('skips trace write when primary short-circuits on idempotency', async () => {
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(fakeRecipe())
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'primary-existing', title: 't' }, created: false })

    const result = await runRecipe('TEST', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' })

    expect(result).toEqual({ status: 'existing', memoryId: 'primary-existing', traceId: null })
    expect(captureMemory).toHaveBeenCalledTimes(1)
  })

  it('routes claude_code surface to expanded() when present', async () => {
    const expandedImpl: (ctx: RecipeContext) => Promise<RecipeOutput> = async (ctx) => ({
      primary: {
        type: 'advisory',
        streamClass: 'advisory',
        source: 'manual',
        title: 'expanded',
        bodyMd: 'x',
        dominionId: ctx.dominionId,
        sourceMetadata: { externalId: 'ex:1' },
      },
      traceMeta: {},
    })
    const expanded = vi.fn(expandedImpl)
    const recipe: Recipe = { ...fakeRecipe(), expanded }
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(recipe)
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'p', title: 'expanded' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 't', title: 'trace' }, created: true })

    await runRecipe('TEST', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'claude_code' })

    expect(expanded).toHaveBeenCalledTimes(1)
    expect(recipe.flat).not.toHaveBeenCalled()
    const traceInput = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<string, unknown>
    expect((traceInput.sourceMetadata as Record<string, unknown>).mode).toBe('expanded')
  })

  it('falls back to flat() for claude_code when expanded missing', async () => {
    const recipe = fakeRecipe()
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(recipe)
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'p', title: 't' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 't', title: 'trace' }, created: true })

    await runRecipe('TEST', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'claude_code' })

    expect(recipe.flat).toHaveBeenCalledTimes(1)
    const traceInput = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<string, unknown>
    expect((traceInput.sourceMetadata as Record<string, unknown>).mode).toBe('flat')
  })
})
