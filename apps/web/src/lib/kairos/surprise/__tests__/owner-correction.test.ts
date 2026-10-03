import { afterEach, describe, expect, it, vi } from 'vitest'

const nextAfter = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', () => ({ after: nextAfter.after }))

import {
  CHAT_CORRECTION_MIN_RANK,
  checkChatCorrection,
  correctionTerms,
  looksLikeCorrection,
  recordNightlyOwnerCorrections,
  scheduleChatCorrectionCheck,
} from '../owner-correction'
import { recordBeliefExtractSurprises } from '../extract-signals'
import { beliefRowValues, type BeliefV1 } from '@/lib/kairos/beliefs/types'

const NOW = new Date('2026-10-03T14:00:00.000Z')
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('correction marker', () => {
  it.each([
    'Actually, I prefer evenings for deep work now',
    "I've changed my mind about shipping weekly",
    "That's not true any more — we dropped the mobile app",
    'I no longer think Rust is worth it',
    'Scratch that, Postgres stays',
    'I was wrong about the pricing page',
  ])('matches: %s', (t) => expect(looksLikeCorrection(t)).toBe(true))

  it.each([
    'Ship the release tonight',
    'What should I work on next?',
    'I believe quality comes first',
    'factually accurate notes please', // "actually" inside a word
  ])('ignores: %s', (t) => expect(looksLikeCorrection(t)).toBe(false))

  it('keeps content words only, lower-case [a-z0-9], capped', () => {
    expect(correctionTerms("Actually, I've changed my mind: evenings beat mornings for deep work!")).toEqual(['evenings', 'beat', 'mornings', 'deep', 'work'])
    expect(correctionTerms('x'.repeat(3))).toEqual([])
  })
})

describe('checkChatCorrection (daytime)', () => {
  const deps = () => ({
    match: vi.fn(async () => [{ id: 'b-1', rank: 0.6 }, { id: 'b-2', rank: CHAT_CORRECTION_MIN_RANK }, { id: 'b-3', rank: 0.1 }]),
    open: vi.fn(async (_u: string, ids: readonly string[]) => [...ids]),
    record: vi.fn(async () => null),
  })

  it('gate off: does nothing at all', async () => {
    const d = deps()
    expect(await checkChatCorrection('u', 'chat:t:1', 'Actually evenings beat mornings', NOW, d)).toEqual([])
    expect(d.match).not.toHaveBeenCalled()
  })

  it('no marker: no search', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    const d = deps()
    expect(await checkChatCorrection('u', 'chat:t:1', 'Evenings beat mornings', NOW, d)).toEqual([])
    expect(d.match).not.toHaveBeenCalled()
  })

  it('opens the top 2 above the rank floor and records one owner_correction (s .5)', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', 'observe')
    const d = deps()
    const opened = await checkChatCorrection('u', 'chat:t:1', 'Actually evenings beat mornings for deep work', NOW, d)
    expect(d.match).toHaveBeenCalledWith('u', ['evenings', 'beat', 'mornings', 'deep', 'work'], 2)
    expect(opened).toEqual(['b-1', 'b-2'])
    expect(d.open).toHaveBeenCalledWith('u', ['b-1', 'b-2'], { kind: 'owner_correction', ref: 'chat:t:1', s: 0.5 }, NOW)
    expect(d.record).toHaveBeenCalledWith('u', expect.objectContaining({ key: 'owner_correction:chat:t:1', kind: 'owner_correction', s: 0.5, opened: ['b-1', 'b-2'] }), { now: NOW })
  })

  it('a failing search never throws', async () => {
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const d = { ...deps(), match: vi.fn(async () => { throw new Error('db down') }) }
    await expect(checkChatCorrection('u', 'chat:t:1', 'Actually evenings win', NOW, d)).resolves.toEqual([])
  })

  it('schedule: off → no after(); on + marker → deferred into after(), nothing awaited inline', () => {
    scheduleChatCorrectionCheck('u', 't', 1, 'Actually evenings win')
    expect(nextAfter.after).not.toHaveBeenCalled()
    vi.stubEnv('KAIROS_SURPRISE_GATE', '1')
    scheduleChatCorrectionCheck('u', 't', 1, 'Evenings win')
    expect(nextAfter.after).not.toHaveBeenCalled()
    scheduleChatCorrectionCheck('u', 't', 1, 'Actually evenings win')
    expect(nextAfter.after).toHaveBeenCalledTimes(1)
  })
})

describe('nightly owner corrections + aha (belief_extract persist)', () => {
  const belief = (over: Partial<BeliefV1> = {}): BeliefV1 => ({
    v: 1, mind: 'aligned', domain: 'general', dominionId: null, claim: 'c', reasons: [], falsifier: 'f',
    sourceType: 'operator', provenance: ['in-1'], status: 'held', confidence: 0.7, ...over,
  })

  it('opens shared-provenance neighbours and records owner_correction s .8', async () => {
    const neighbours = vi.fn(async () => ['nb-1'])
    const open = vi.fn(async (_u: string, ids: readonly string[]) => [...ids])
    const record = vi.fn(async () => ({}) as never)
    const n = await recordNightlyOwnerCorrections('u', 'belief_extract:2026-10-03', [{ newId: 'new-1', targetId: 'old-1', targetProvenance: ['m-1'] }], NOW, { neighbours, open, record })
    expect(n).toBe(1)
    expect(neighbours).toHaveBeenCalledWith('u', ['m-1'], ['old-1', 'new-1'], 5)
    expect(open).toHaveBeenCalledWith('u', ['nb-1'], { kind: 'owner_correction', ref: 'old-1', s: 0.8 }, NOW)
    expect(record).toHaveBeenCalledWith('u', expect.objectContaining({ key: 'owner_correction:belief_extract:2026-10-03:old-1', s: 0.8, opened: ['nb-1'], refs: { beliefIds: ['old-1', 'new-1'], memoryIds: ['m-1'] } }), { now: NOW })
  })

  it('records an aha when a replace resolves a questioned belief (only for what the write applied)', async () => {
    const record = vi.fn(async () => null)
    const corrections = vi.fn(async () => 0)
    const create = [
      { values: beliefRowValues(belief({ supersedes: 'q-1', provenance: ['in-1'] })), supersedes: 'q-1', reason: 'r' },
      { values: beliefRowValues(belief({ supersedes: 'gated', provenance: ['in-1'] })), supersedes: 'gated', reason: 'r' },
    ]
    await recordBeliefExtractSurprises('u', 'belief_extract:2026-10-03', {
      inputIds: ['in-1'], questionedIds: ['q-1', 'gated'], create, reinforce: [],
      result: { written: true, created: ['n-1', 'n-2'], superseded: ['q-1'], reinforced: [], retired: [], refusedReplaces: [], gatedReplaces: ['gated'], ownerCorrections: [] },
    }, NOW, { record, corrections })
    expect(corrections).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('u', expect.objectContaining({ kind: 'aha', refs: { beliefIds: ['q-1', 'n-1'], memoryIds: ['in-1'] } }), { now: NOW })
  })
})
