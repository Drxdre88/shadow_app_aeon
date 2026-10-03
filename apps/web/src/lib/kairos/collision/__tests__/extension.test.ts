import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listCollisionCandidates: vi.fn(),
  readLatestAetherEmbedding: vi.fn(),
  listRecentCollisionPairKeys: vi.fn(),
  memoriesLive: vi.fn(),
  recordBridgeLinked: vi.fn(),
  addLink: vi.fn(),
}))
vi.mock('@/lib/data/idea-bridges', () => ({
  listCollisionCandidates: m.listCollisionCandidates,
  readLatestAetherEmbedding: m.readLatestAetherEmbedding,
  listRecentCollisionPairKeys: m.listRecentCollisionPairKeys,
  memoriesLive: m.memoriesLive,
  recordBridgeLinked: m.recordBridgeLinked,
}))
vi.mock('@/lib/data/memories', () => ({ addLink: m.addLink }))

import { collisionExtension as ext } from '../../thinking/handlers/idea-ext/collision'
import { BRIDGE_NOTE_PREFIX, bridgeNote, isBridgeNote } from '../bridge'
import type { IdeaOutcomeEvent } from '../../thinking/handlers/idea-ext/types'
import type { IdeaBridgeMeta, IdeaMeta } from '../../ideas/types'

const IDEA = '11111111-1111-4111-8111-111111111111'
const BRIDGE: IdeaBridgeMeta = {
  v: 1, pairKey: 'ma:mb', aId: 'ma', bId: 'mb', aArea: 'Work', bArea: null, cos: 0.24,
  relations: [], map: [], insight: 'Clear what crowds focus first.', mappingHolds: null,
}
const event = (over: Partial<IdeaOutcomeEvent> = {}): IdeaOutcomeEvent => ({
  userId: 'u1', memoryId: IDEA, meta: { kind: 'idea', idea: { bridge: BRIDGE } }, outcome: 'accepted', origin: undefined, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.memoriesLive.mockResolvedValue(true)
  m.addLink.mockResolvedValue({ created: true })
  m.recordBridgeLinked.mockResolvedValue(true)
})
afterEach(() => vi.unstubAllEnvs())

describe('bridge note', () => {
  it('names the idea with the agreed prefix and caps length', () => {
    expect(bridgeNote(IDEA, ' a\n b ')).toBe(`bridge · idea:${IDEA} · a b`)
    expect(isBridgeNote(bridgeNote(IDEA, 'x'))).toBe(true)
    expect(isBridgeNote('plain note')).toBe(false)
    expect(bridgeNote(IDEA, 'y'.repeat(900))).toHaveLength(500)
    expect(BRIDGE_NOTE_PREFIX).toBe('bridge · idea:')
  })
})

describe('onIdeaOutcome bridge write', () => {
  it('owner accept with the flag on links A → B as relates', async () => {
    vi.stubEnv('KAIROS_COLLISIONS', '1')
    await ext.onIdeaOutcome!(event())
    expect(m.memoriesLive).toHaveBeenCalledWith('u1', ['ma', 'mb'])
    expect(m.addLink).toHaveBeenCalledWith('ma', 'u1', {
      type: 'relates', target: 'mb', targetKind: 'memory', note: `bridge · idea:${IDEA} · Clear what crowds focus first.`,
    })
    expect(m.recordBridgeLinked).toHaveBeenCalledWith('u1', IDEA)
  })

  it('operator origin also bridges; an existing link is not re-stamped', async () => {
    vi.stubEnv('KAIROS_COLLISIONS', 'on')
    m.addLink.mockResolvedValue({ created: false })
    await ext.onIdeaOutcome!(event({ origin: { kind: 'operator', via: 'rest-session' } }))
    expect(m.addLink).toHaveBeenCalledTimes(1)
    expect(m.recordBridgeLinked).not.toHaveBeenCalled()
  })

  it.each([
    ['agent origin', { origin: { kind: 'agent' as const, via: 'mcp' } }, '1'],
    ['dismiss', { outcome: 'dismissed' as const }, '1'],
    ['no bridge on the idea', { meta: { kind: 'idea', idea: {} } }, '1'],
    ['flag off', {}, ''],
    ['observe', {}, 'observe'],
  ])('writes nothing: %s', async (_name, over, flag) => {
    vi.stubEnv('KAIROS_COLLISIONS', flag)
    await ext.onIdeaOutcome!(event(over))
    expect(m.addLink).not.toHaveBeenCalled()
    expect(m.memoriesLive).not.toHaveBeenCalled()
  })

  it('skips a dead endpoint and swallows write errors', async () => {
    vi.stubEnv('KAIROS_COLLISIONS', '1')
    m.memoriesLive.mockResolvedValueOnce(false)
    await ext.onIdeaOutcome!(event())
    expect(m.addLink).not.toHaveBeenCalled()
    m.addLink.mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(ext.onIdeaOutcome!(event())).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('judge-side hooks', () => {
  const stored = { bridge: BRIDGE } as never
  const sel = { key: 'c1', status: 'survivor', eliminatedReason: null, rank: 1 } as const
  const crit = (mappingHolds?: boolean) => ({ verdict: 'grounded', supports: ['x'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '', ...(mappingHolds === undefined ? {} : { mappingHolds }) }) as never

  it('metaExtras carries the bridge only when on, with the judge verdict or null', () => {
    vi.stubEnv('KAIROS_COLLISIONS', '1')
    expect(ext.metaExtras!(stored, sel, crit(), {} as never)).toEqual({ bridge: { ...BRIDGE, mappingHolds: null } })
    expect(ext.metaExtras!(stored, sel, crit(true), {} as never)).toEqual({ bridge: { ...BRIDGE, mappingHolds: true } })
    expect(ext.metaExtras!({} as never, sel, crit(), {} as never)).toBeNull()
    vi.stubEnv('KAIROS_COLLISIONS', '')
    expect(ext.metaExtras!(stored, sel, crit(), {} as never)).toBeNull()
  })

  it('composeExtraLines renders the collision block only with a bridge', () => {
    expect(ext.composeExtraLines!({ bridge: BRIDGE } as IdeaMeta)).toEqual(['**Collision.** Work ↔ cross-cutting — Clear what crowds focus first.'])
    expect(ext.composeExtraLines!({} as IdeaMeta)).toEqual([])
  })

  it('parseOptions is empty unless flag and job context are both on with pairs', () => {
    const pairs = [{ id: 'p1', pairKey: 'a:b', aId: 'a', bId: 'b', aArea: null, bArea: null, aDate: '', bDate: '', aText: '', bText: '', cos: 0.2, relevance: 0.5, score: 0.4 }]
    const on = { collision: { v: 1, mode: 'on', anchor: 'aether', considered: 1, pairs } }
    vi.stubEnv('KAIROS_COLLISIONS', '')
    expect(ext.parseOptions!(on)).toEqual({})
    vi.stubEnv('KAIROS_COLLISIONS', '1')
    expect(ext.parseOptions!({})).toEqual({})
    expect(ext.parseOptions!({ collision: { ...on.collision, mode: 'observe' } })).toEqual({})
    expect(ext.parseOptions!({ collision: { ...on.collision, pairs: [] } })).toEqual({})
    const opts = ext.parseOptions!(on)
    expect(opts.keepRaw).toBe(true)
    const built = { key: 'c1' } as never
    expect(opts.extendCandidate!({ blend: 'p1' }, built, {} as never)).toEqual({ key: 'c1', blend: 'p1' })
    expect(opts.extendCandidate!({}, built, {} as never)).toBe(built)
  })
})
