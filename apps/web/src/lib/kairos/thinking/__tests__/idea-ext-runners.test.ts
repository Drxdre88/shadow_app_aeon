import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SelectionInput, SelectionResult } from '@/lib/kairos/ideas/select'
import type { IdeaMeta } from '@/lib/kairos/ideas/types'
import {
  IDEA_EXTENSIONS,
  runComposeExtraLines,
  runMetaExtras,
  runOnIdeaOutcome,
  runParseOptions,
  runPlanGenerate,
  runPostSelect,
  type IdeaExtension,
  type JudgeApplyScope,
  type NamedIdeaExtension,
} from '../handlers/idea-ext'

const named = (name: string, ext: IdeaExtension): NamedIdeaExtension => ({ name, ext })
const boom = () => { throw new Error('boom') }
const scope = {} as JudgeApplyScope

afterEach(() => vi.restoreAllMocks())

describe('idea-ext registry', () => {
  it('runs in fixed order: stepping, atlas, collision, sameness', () => {
    expect(IDEA_EXTENSIONS.map((e) => e.name)).toEqual(['stepping', 'atlas', 'collision', 'sameness'])
  })
})

describe('idea-ext runners', () => {
  it('pass the very same object through when no extension implements a hook', async () => {
    const empty = [named('a', {}), named('b', {})]
    const draft = { system: 's', prompt: 'p', validMemoryIds: [], context: { date: '2026-10-01', dominions: [], inputErrors: [] } }
    const ctx = { userId: 'u', now: new Date(), day: '2026-10-01', dominions: [], errors: [], inputs: {} as never }
    expect(await runPlanGenerate(draft, ctx, empty)).toBe(draft)
    expect(runParseOptions({}, empty)).toBeUndefined()
    expect(runParseOptions({}, [named('a', { parseOptions: () => ({}) })])).toBeUndefined()
    const sel: SelectionResult[] = [{ key: 'c1', status: 'survivor', eliminatedReason: null, rank: 1 }]
    expect(runPostSelect(sel, [], scope, empty)).toBe(sel)
    expect(runMetaExtras({} as never, sel[0], null, scope, empty)).toEqual({})
    expect(runComposeExtraLines({} as IdeaMeta, empty)).toEqual([])
  })

  it('a throwing planGenerate is logged, recorded in inputErrors, and later lanes still run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const draft = { system: 's', prompt: 'p', validMemoryIds: [], context: { date: '2026-10-01', dominions: [], inputErrors: [] } }
    const errors: string[] = []
    const ctx = { userId: 'u', now: new Date(), day: '2026-10-01', dominions: [], errors, inputs: {} as never }
    const out = await runPlanGenerate(draft, ctx, [
      named('bad', { planGenerate: boom }),
      named('good', { planGenerate: (d) => ({ ...d, system: `${d.system}\nmore` }) }),
    ])
    expect(out.system).toBe('s\nmore')
    expect(errors).toEqual(['ext:bad.planGenerate: boom'])
    expect(warn).toHaveBeenCalled()
  })

  it('merges parse options across lanes and guards each extender', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const opts = runParseOptions({}, [
      named('a', { parseOptions: () => ({ extendCandidate: (_r, b) => ({ ...b, kind: 'make' as const }), skipCap: true }) }),
      named('b', { parseOptions: () => ({ extendCandidate: boom, keepRaw: true }) }),
      named('c', { parseOptions: boom }),
    ])!
    expect(opts.skipCap).toBe(true)
    expect(opts.keepRaw).toBe(true)
    const built = { key: 'c1', direction: 'd', title: 't', claim: 'c', why: 'w', nextStep: 'n', citedIds: [] }
    expect(opts.extendCandidate!({}, built, { id: 'd1', label: 'd', move: 'stop', dominion: null })).toEqual({ ...built, kind: 'make' })
  })

  it('postSelect must keep one result per input in order, else it is ignored', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sel: SelectionResult[] = [
      { key: 'c1', status: 'survivor', eliminatedReason: null, rank: 1 },
      { key: 'c2', status: 'eliminated', eliminatedReason: 'ranked_out', rank: 2 },
    ]
    const inputs = [] as SelectionInput[]
    expect(runPostSelect(sel, inputs, scope, [named('x', { postSelect: (s) => s.slice(1) })])).toBe(sel)
    expect(runPostSelect(sel, inputs, scope, [named('x', { postSelect: boom })])).toBe(sel)
    const swapped = runPostSelect(sel, inputs, scope, [named('x', { postSelect: (s) => s.map((r) => ({ ...r, status: 'survivor' as const })) })])
    expect(swapped.map((r) => r.status)).toEqual(['survivor', 'survivor'])
  })

  it('meta extras and extra lines merge in order; a throwing lane contributes nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sel: SelectionResult = { key: 'c1', status: 'survivor', eliminatedReason: null, rank: 1 }
    const exts = [
      named('a', { metaExtras: () => ({ move: 'test' }), composeExtraLines: () => ['A'] }),
      named('b', { metaExtras: boom, composeExtraLines: boom }),
      named('c', { metaExtras: () => ({ round: 'novelty' }), composeExtraLines: () => ['C'] }),
    ]
    expect(runMetaExtras({} as never, sel, null, scope, exts)).toEqual({ move: 'test', round: 'novelty' })
    expect(runComposeExtraLines({} as IdeaMeta, exts)).toEqual(['A', 'C'])
  })

  it('onIdeaOutcome never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen = vi.fn()
    await expect(runOnIdeaOutcome(
      { userId: 'u', memoryId: 'm', meta: {}, outcome: 'accepted', origin: undefined },
      [named('bad', { onIdeaOutcome: boom }), named('good', { onIdeaOutcome: seen })],
    )).resolves.toBeUndefined()
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
