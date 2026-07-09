import { describe, it, expect, vi, beforeEach } from 'vitest'

// router.ts (source of the credential-error classes) imports '@/lib/db' at
// module scope, which throws outside a real DB env — stub it, unused here.
vi.mock('@/lib/db', () => ({ db: {} }))

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
import { AiCredentialMissingError } from '@/lib/ai/router'
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
    expect(recipe.expanded).toBeUndefined()
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(recipe)
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'p', title: 't' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 't', title: 'trace' }, created: true })

    await runRecipe('TEST', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'claude_code' })

    expect(recipe.flat).toHaveBeenCalledTimes(1)
    const traceInput = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[1][1] as Record<string, unknown>
    expect((traceInput.sourceMetadata as Record<string, unknown>).mode).toBe('flat')
  })

  it('writes a failure trace (no partial primary) when the recipe throws', async () => {
    const throwingRecipe: Recipe = {
      name: 'BOOM',
      description: 'throws on flat',
      reads: ['cortex'],
      writes: ['advisory'],
      flat: vi.fn(async () => { throw new Error('upstream provider down') }),
    }
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(throwingRecipe)
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'trace-boom', title: 'trace' }, created: true })

    await expect(runRecipe('BOOM', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' }))
      .rejects.toThrow('upstream provider down')

    expect(captureMemory).toHaveBeenCalledTimes(1)
    const traceInput = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>
    expect(traceInput.streamClass).toBe('trace')
    expect(traceInput.dominionId).toBe(DOMINION_ID)
    const sm = traceInput.sourceMetadata as Record<string, unknown>
    expect(sm.cronName).toBe('recipe:BOOM')
    expect(sm.reason).toBe('recipe_threw')
    expect(sm.error).toBe('upstream provider down')
  })

  it('does NOT write a failure trace when the recipe throws a credential error', async () => {
    const throwingRecipe: Recipe = {
      name: 'BOOM',
      description: 'throws on flat',
      reads: ['cortex'],
      writes: ['advisory'],
      flat: vi.fn(async () => { throw new AiCredentialMissingError('anthropic') }),
    }
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(throwingRecipe)

    await expect(runRecipe('BOOM', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' }))
      .rejects.toBeInstanceOf(AiCredentialMissingError)

    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('writes primary + each extra + trace (in that order) when extras present', async () => {
    const withExtras: (ctx: RecipeContext) => Promise<RecipeOutput> = async (ctx) => ({
      primary: {
        type: 'advisory',
        streamClass: 'advisory',
        source: 'cron',
        title: 'primary title',
        bodyMd: 'p',
        dominionId: ctx.dominionId,
        sourceMetadata: { externalId: 'ext:1' },
      },
      extras: [
        { type: 'note', streamClass: 'reflection', source: 'system', title: 'extra A', bodyMd: 'a', dominionId: ctx.dominionId },
        { type: 'note', streamClass: 'reflection', source: 'system', title: 'extra B', bodyMd: 'b', dominionId: ctx.dominionId },
      ],
      traceMeta: {},
    })
    const recipe: Recipe = {
      name: 'WITH_EXTRAS',
      description: 'extras recipe',
      reads: ['cortex'],
      writes: ['advisory'],
      flat: vi.fn(withExtras),
    }
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(recipe)
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'p1', title: 'primary title' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 'a1', title: 'extra A' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 'b1', title: 'extra B' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 'tr1', title: 'trace' }, created: true })

    await runRecipe('WITH_EXTRAS', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' })

    const calls = (captureMemory as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(4)
    expect((calls[0][1] as { title: string }).title).toBe('primary title')
    expect((calls[1][1] as { title: string }).title).toBe('extra A')
    expect((calls[2][1] as { title: string }).title).toBe('extra B')
    expect((calls[3][1] as { streamClass: string }).streamClass).toBe('trace')
  })

  it('still writes trace when an extra throws (extrasErrors captured)', async () => {
    const withFailingExtra: (ctx: RecipeContext) => Promise<RecipeOutput> = async (ctx) => ({
      primary: {
        type: 'advisory',
        streamClass: 'advisory',
        source: 'cron',
        title: 'p',
        bodyMd: 'p',
        dominionId: ctx.dominionId,
        sourceMetadata: { externalId: 'ext:1' },
      },
      extras: [
        { type: 'note', streamClass: 'reflection', source: 'system', title: 'doomed extra', bodyMd: 'x', dominionId: ctx.dominionId },
      ],
      traceMeta: {},
    })
    const recipe: Recipe = {
      name: 'FAIL_EXTRA',
      description: 'extra throws',
      reads: ['cortex'],
      writes: ['advisory'],
      flat: vi.fn(withFailingExtra),
    }
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(recipe)
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'p1', title: 'p' }, created: true })
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({ memory: { id: 'tr1', title: 'trace' }, created: true })

    const result = await runRecipe('FAIL_EXTRA', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' })

    expect(result.status).toBe('created')
    expect(captureMemory).toHaveBeenCalledTimes(3)
    const traceCall = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[2]
    const traceInput = traceCall[1] as Record<string, unknown>
    const sm = traceInput.sourceMetadata as { extrasErrors?: Array<{ title: string; message: string }> }
    expect(sm.extrasErrors).toBeTruthy()
    expect(sm.extrasErrors).toHaveLength(1)
    expect(sm.extrasErrors![0]).toEqual({ title: 'doomed extra', message: 'db hiccup' })
  })

  it('trace bodyMd is JSON of the same shape as sourceMetadata', async () => {
    ;(getRecipe as ReturnType<typeof vi.fn>).mockReturnValue(fakeRecipe())
    ;(captureMemory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ memory: { id: 'p1', title: 'TEST primary' }, created: true })
      .mockResolvedValueOnce({ memory: { id: 't1', title: 'trace' }, created: true })

    await runRecipe('TEST', { userId: USER_ID, dominionId: DOMINION_ID, surface: 'byok' })

    const traceCall = (captureMemory as ReturnType<typeof vi.fn>).mock.calls[1]
    const traceInput = traceCall[1] as Record<string, unknown>
    const parsedBody = JSON.parse(traceInput.bodyMd as string)
    expect(parsedBody).toMatchObject({
      recipe: 'TEST',
      mode: 'flat',
      primaryMemoryId: 'p1',
      foo: 'bar',
    })
    expect(typeof parsedBody.durationMs).toBe('number')
    expect(parsedBody.durationMs).toBeGreaterThanOrEqual(0)
    // bodyMd content matches sourceMetadata content.
    expect(parsedBody).toEqual(traceInput.sourceMetadata)
  })
})
