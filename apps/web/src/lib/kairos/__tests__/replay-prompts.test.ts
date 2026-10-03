import { describe, expect, it } from 'vitest'
import {
  aetherFedMemoryIds,
  buildAetherUserPrompt,
  withAetherReplay,
  type AetherContext,
  type AetherReplayRow,
  type GlobalReflectionRow,
} from '../aether-prompt'
import { buildCortexUserPrompt, type CortexContext } from '../cortex-prompt'

// Replay in the syntheses (spec_surprise Lane 3): off/observe leave every
// prompt byte-identical; on adds one section and the replay ids become
// citable in the aether (render-only in the cortex).

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

const reflections = (n: number): GlobalReflectionRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: uuid(i + 1),
    dominionId: null,
    dominionName: null,
    title: `Reflection ${i + 1}`,
    summary: null,
    createdAt: new Date('2026-10-01'),
  }))

const aetherCtx = (over: Partial<AetherContext> = {}): AetherContext => ({
  userId: 'u',
  today: '2026-10-03',
  cortexSnapshots: [],
  topReflections: reflections(40),
  archetypes: [],
  prior: null,
  ...over,
})

const replayRows = (ids: string[]): AetherReplayRow[] =>
  ids.map((id) => ({ id, title: `Due ${id.slice(0, 4)}`, summary: 'soon', note: 'prediction due soon' }))

describe('aether replay', () => {
  it('off / observe / empty: the very same ctx, so prompt and fed ids are unchanged', () => {
    const ctx = aetherCtx()
    const before = buildAetherUserPrompt(ctx)
    const rows = replayRows([uuid(900)])
    expect(withAetherReplay(ctx, null)).toBe(ctx)
    expect(withAetherReplay(ctx, { mode: 'observe', items: rows })).toBe(ctx)
    expect(withAetherReplay(ctx, { mode: 'on', items: [] })).toBe(ctx)
    expect(buildAetherUserPrompt(withAetherReplay(ctx, { mode: 'observe', items: rows }))).toBe(before)
    expect(before).not.toContain('Due soon / under question')
  })

  it('on: renders the section, keeps ≥32 recency slots and makes replay ids citable', () => {
    const ids = Array.from({ length: 8 }, (_, i) => uuid(900 + i))
    const out = withAetherReplay(aetherCtx(), { mode: 'on', items: replayRows(ids) })
    expect(out.topReflections).toHaveLength(32)
    expect(out.replay).toHaveLength(8)
    const prompt = buildAetherUserPrompt(out)
    expect(prompt).toContain('## Due soon / under question')
    expect(prompt).toContain(`- [${ids[0]}] (prediction due soon) Due 0000 — soon`)
    const fed = aetherFedMemoryIds(out)
    for (const id of ids) expect(fed.has(id)).toBe(true)
  })

  it('on: few replay rows trim the recency list less; never below 32', () => {
    expect(withAetherReplay(aetherCtx(), { mode: 'on', items: replayRows([uuid(900), uuid(901)]) }).topReflections).toHaveLength(38)
    expect(withAetherReplay(aetherCtx({ topReflections: reflections(10) }), { mode: 'on', items: replayRows([uuid(900)]) }).topReflections).toHaveLength(10)
  })

  it('on: a replay row already fed as a reflection is not repeated', () => {
    const ctx = aetherCtx({ topReflections: reflections(5) })
    expect(withAetherReplay(ctx, { mode: 'on', items: replayRows([uuid(1)]) })).toBe(ctx)
  })
})

const cortexCtx = (over: Partial<CortexContext> = {}): CortexContext => ({
  dominionId: 'd',
  name: 'AEON',
  vision: null,
  missionLong: null,
  objectives: [],
  boardTasks: [],
  reflections: [],
  archetypes: [],
  prior: null,
  ...over,
})

describe('cortex due soon', () => {
  it('absent → prompt unchanged; present → a render-only section with no ids', () => {
    const before = buildCortexUserPrompt(cortexCtx(), '2026-10-03')
    expect(buildCortexUserPrompt(cortexCtx({ dueSoon: [] }), '2026-10-03')).toBe(before)
    const prompt = buildCortexUserPrompt(cortexCtx({ dueSoon: [{ title: 'Ship the beta', note: 'open goal' }] }), '2026-10-03')
    expect(prompt).toContain('## Due soon in this area\n- Ship the beta (open goal)')
    expect(prompt.indexOf('## Due soon in this area')).toBeLessThan(prompt.indexOf('## Owner reflections'))
  })
})
