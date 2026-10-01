import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'

const data = vi.hoisted(() => ({
  listHeldBeliefs: vi.fn(),
  listOperatorSignals: vi.fn(),
  listRecentExtractJobs: vi.fn(),
  listBeliefEvidence: vi.fn(),
  listMemoryOrigins: vi.fn(),
  listFlaggedAlignedBeliefs: vi.fn(),
  thinkingJobKeyExists: vi.fn(),
  writeAlignedBeliefs: vi.fn(),
  writeMindCompare: vi.fn(),
  findDominionsByUser: vi.fn(),
  getProviderForUser: vi.fn(),
}))

vi.mock('@/lib/data/beliefs', () => ({
  listHeldBeliefs: data.listHeldBeliefs,
  listOperatorSignals: data.listOperatorSignals,
  listRecentExtractJobs: data.listRecentExtractJobs,
  listBeliefEvidence: data.listBeliefEvidence,
  listMemoryOrigins: data.listMemoryOrigins,
  thinkingJobKeyExists: data.thinkingJobKeyExists,
  writeAlignedBeliefs: data.writeAlignedBeliefs,
  writeMindCompare: data.writeMindCompare,
  MIND_COMPARE_KIND: 'mind_compare',
  SIGNAL_INPUT_CAP: 60,
}))
vi.mock('@/lib/data/belief-recheck', () => ({ listFlaggedAlignedBeliefs: data.listFlaggedAlignedBeliefs, RECHECK_IN_PROMPT_CAP: 20 }))
vi.mock('@/lib/data/thinking-jobs', () => ({ FALLBACK_ERROR_PREFIX: 'fallback:' }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: data.findDominionsByUser }))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: data.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))

import { AiCredentialMissingError } from '@/lib/ai/router'
import { beliefExtractHandler, drainBatch, extractInFlight, extractWatermark } from '../handlers/belief-extract'
import { mindCompareHandler } from '../handlers/mind-compare'

const USER = 'user-1'
const IN1 = '11111111-aaaa-4aaa-8aaa-111111111111'
const IN2 = '22222222-bbbb-4bbb-8bbb-222222222222'
const HELD = '33333333-cccc-4ccc-8ccc-333333333333'
const OWN = '44444444-dddd-4ddd-8ddd-444444444444'
const OWN2 = '55555555-eeee-4eee-8eee-555555555555'
const FLAG = '66666666-ffff-4fff-8fff-666666666666'
const EVID = '77777777-aaaa-4aaa-8aaa-777777777777'
const NIGHT = new Date('2026-10-01T03:00:00Z') // Thursday
const MONDAY = new Date('2026-10-05T04:30:00Z')

function signal(id: string, at: string, origin: string = 'operator') {
  return { id, title: `t-${id.slice(0, 4)}`, aiTitle: null, summary: 'I believe in small ships', bodyMd: 'b', type: 'reflection', kind: null, createdAt: new Date(at), origin }
}

function flagged(id = FLAG) {
  return {
    id,
    belief: {
      v: 1, mind: 'aligned', domain: 'Aeon', dominionId: 'dom-1', claim: 'Mornings are for deep work', reasons: [], falsifier: 'x',
      sourceType: 'operator', provenance: [EVID, 'gone-1'], status: 'held', confidence: 0.49,
      recheck: { since: '2026-09-30T02:45:00.000Z', lostSources: [{ id: 'gone-1', state: 'missing' }] },
    },
  }
}

function jobFrom(spec: ThinkingJobSpec): ThinkingJobRow {
  const now = new Date()
  return {
    id: '99999999-0000-4000-8000-000000000009', userId: USER, kind: spec.kind, dominionId: spec.dominionId,
    externalKey: spec.externalKey, status: 'claimed', input: spec.input, output: null, claimedBy: 'routine',
    claimToken: 't', claimedAt: now, deadlineAt: now, completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now,
  }
}

const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

beforeEach(() => {
  vi.clearAllMocks()
  data.thinkingJobKeyExists.mockResolvedValue(false)
  data.listRecentExtractJobs.mockResolvedValue([])
  // Oldest first, as listOperatorSignals returns them.
  data.listOperatorSignals.mockResolvedValue([signal(IN1, '2026-09-30T08:00:00Z'), signal(IN2, '2026-09-30T20:00:00Z')])
  data.listHeldBeliefs.mockImplementation(async (_u: string, mind: string) =>
    mind === 'aligned'
      ? [{ id: HELD, domain: 'Aeon', claim: 'Quality first', embedding: [1, 0, 0] }]
      : [{ id: OWN, domain: 'Aeon', claim: 'Quality matters most', embedding: [0.99, 0.05, 0] }, { id: OWN2, domain: 'general', claim: 'Rest', embedding: [0, 0, 1] }])
  data.findDominionsByUser.mockResolvedValue([{ id: 'dom-1', name: 'Aeon', archivedAt: null }, { id: 'dom-x', name: 'Old', archivedAt: new Date() }])
  data.writeAlignedBeliefs.mockResolvedValue({ written: true, created: ['new-1'], superseded: [HELD], reinforced: [], retired: [], refusedReplaces: [] })
  data.listMemoryOrigins.mockImplementation(async (_u: string, ids: string[]) => new Map(ids.map((id) => [id, 'operator'])))
  data.listFlaggedAlignedBeliefs.mockResolvedValue([])
  data.listBeliefEvidence.mockResolvedValue([])
  data.writeMindCompare.mockResolvedValue({ memoryId: 'cmp-1', written: true })
})

describe('belief_extract plan', () => {
  it('waits for the 02:30 UTC archetype run', async () => {
    expect(await beliefExtractHandler.plan(USER, new Date('2026-10-01T02:29:00Z'))).toEqual([])
    expect(data.listOperatorSignals).not.toHaveBeenCalled()
  })

  it('plans one 4h job over new operator signals with held beliefs and live dominions', async () => {
    const [spec] = await beliefExtractHandler.plan(USER, NIGHT)
    expect(spec).toMatchObject({ kind: 'belief_extract', externalKey: 'belief_extract:2026-10-01', deadlineMinutes: 240, dominionId: null })
    expect(spec.input.validMemoryIds).toEqual([IN2, IN1, HELD])
    expect(spec.input.context).toMatchObject({ inputsUntil: '2026-09-30T20:00:00.000Z', heldIds: [HELD], dominions: [{ id: 'dom-1', name: 'Aeon' }] })
    expect(spec.input.prompt).toContain(`[${HELD}] (Aeon) Quality first`)
  })

  it('reads signals since the last completed extraction watermark', async () => {
    const until = new Date('2026-09-29T00:00:00Z')
    data.listRecentExtractJobs.mockResolvedValue([{ status: 'failed', error: 'x', inputsUntil: null }, { status: 'done', error: null, inputsUntil: until }])
    await beliefExtractHandler.plan(USER, NIGHT)
    expect(data.listOperatorSignals).toHaveBeenCalledWith(USER, until, 60)
  })

  it('skips when today is planned, a job is in flight, or nothing new was said', async () => {
    data.thinkingJobKeyExists.mockResolvedValueOnce(true)
    expect(await beliefExtractHandler.plan(USER, NIGHT)).toEqual([])
    data.listRecentExtractJobs.mockResolvedValueOnce([{ status: 'expired', error: 'deadline', inputsUntil: null }])
    expect(await beliefExtractHandler.plan(USER, NIGHT)).toEqual([])
    data.listOperatorSignals.mockResolvedValueOnce([])
    expect(await beliefExtractHandler.plan(USER, NIGHT)).toEqual([])
  })

  it('treats an expired job whose fallback already ran as settled', () => {
    expect(extractInFlight([{ status: 'expired', error: 'fallback: no BYOK credential', inputsUntil: null }])).toBe(false)
    expect(extractInFlight([{ status: 'claimed', error: null, inputsUntil: null }])).toBe(true)
    expect(extractWatermark([{ status: 'fallback', error: null, inputsUntil: NIGHT }])).toBe(NIGHT)
  })

  it('drains a backlog oldest first: the watermark is the newest row consumed, not the newest overall', async () => {
    // A full batch of 60, oldest first (newer rows beyond the cap stay unread).
    const base = Date.parse('2026-09-01T00:00:00Z')
    const ids = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
    data.listOperatorSignals.mockResolvedValueOnce(ids.map((id, i) => signal(id, new Date(base + i * 3_600_000).toISOString())))
    const [spec] = await beliefExtractHandler.plan(USER, NIGHT)
    const ctx = spec.input.context as { inputsUntil: string; inputIds: string[] }
    // A full batch gives back the rows at its last timestamp (they may have
    // unread twins), so it consumes 59 and the 60th leads the next night.
    expect(ctx.inputsUntil).toBe(new Date(base + 58 * 3_600_000).toISOString())
    expect(ctx.inputIds).toHaveLength(59)
    // Prompt and provenance read newest first.
    expect(ctx.inputIds[0]).toBe(ids[58])
  })

  it('a full batch gives back a trailing timestamp tie so the strict watermark cannot skip its cut-off twins', () => {
    const at = (h: number) => ({ createdAt: new Date(Date.UTC(2026, 8, 1, h)) })
    const rows = [at(1), at(2), at(3), at(3)]
    expect(drainBatch(rows, 4)).toEqual([at(1), at(2)])
    expect(drainBatch(rows, 5)).toEqual(rows)
    const allTied = [at(3), at(3)]
    expect(drainBatch(allTied, 2)).toEqual(allTied)
  })
})

describe('belief_extract re-examination planning', () => {
  it('plans a job on flagged aligned beliefs alone, carrying the watermark forward', async () => {
    const until = new Date('2026-09-29T00:00:00Z')
    data.listRecentExtractJobs.mockResolvedValue([{ status: 'done', error: null, inputsUntil: until }])
    data.listOperatorSignals.mockResolvedValue([])
    data.listFlaggedAlignedBeliefs.mockResolvedValue([flagged()])
    data.listBeliefEvidence.mockResolvedValue([signal(EVID, '2026-09-20T08:00:00Z', 'kairos')])
    const [spec] = await beliefExtractHandler.plan(USER, NIGHT)
    expect(data.listBeliefEvidence).toHaveBeenCalledWith(USER, [EVID])
    expect(spec.input.context).toMatchObject({ inputIds: [], inputsUntil: until.toISOString(), flaggedIds: [FLAG], evidenceIds: [EVID] })
    expect((spec.input.context as { heldIds: string[] }).heldIds).toEqual(expect.arrayContaining([HELD, FLAG]))
    expect(spec.input.validMemoryIds).toEqual(expect.arrayContaining([EVID, FLAG]))
    expect(spec.input.prompt).toContain('These beliefs lost part of their support. For each: reaffirm (cite remaining or new evidence), replace, or retire.')
    expect(spec.input.prompt).toContain(`[${FLAG}] (Aeon) Mornings are for deep work — lost 1 source(s)`)
    expect(spec.input.prompt).toContain(`[${EVID}] 2026-09-20 (reflection) Kairos's summary of a chat:`)
  })

  it('does not re-plan flags a settled job already put to the model when nothing new was said', async () => {
    data.listRecentExtractJobs.mockResolvedValue([{ status: 'done', error: null, inputsUntil: null, flaggedIds: [FLAG] }])
    data.listOperatorSignals.mockResolvedValue([])
    data.listFlaggedAlignedBeliefs.mockResolvedValue([flagged()])
    expect(await beliefExtractHandler.plan(USER, NIGHT)).toEqual([])
  })

  it('rotates the flag window: least recently presented last, and any unpresented flag triggers a job', async () => {
    data.listRecentExtractJobs.mockResolvedValue([
      { status: 'done', error: null, inputsUntil: null, flaggedIds: [OWN] },
      { status: 'failed', error: 'x', inputsUntil: null, flaggedIds: [OWN2] },
      { status: 'done', error: null, inputsUntil: null, flaggedIds: [HELD, OWN] },
    ])
    data.listOperatorSignals.mockResolvedValue([])
    // The data layer puts never-presented flags first (#21+ included).
    data.listFlaggedAlignedBeliefs.mockResolvedValue([flagged(FLAG), flagged(HELD), flagged(OWN)])
    const [spec] = await beliefExtractHandler.plan(USER, NIGHT)
    expect(data.listFlaggedAlignedBeliefs).toHaveBeenCalledWith(USER, 20, [HELD, OWN])
    expect((spec.input.context as { flaggedIds: string[] }).flaggedIds).toEqual([FLAG, HELD, OWN])
  })

  it('does not plan when there are neither signals nor flags', async () => {
    data.listOperatorSignals.mockResolvedValue([])
    expect(await beliefExtractHandler.plan(USER, NIGHT)).toEqual([])
  })

  it('labels each input by origin in the prompt', async () => {
    data.listOperatorSignals.mockResolvedValue([signal(IN1, '2026-09-30T08:00:00Z', 'operator'), signal(IN2, '2026-09-30T20:00:00Z', 'agent')])
    const [spec] = await beliefExtractHandler.plan(USER, NIGHT)
    expect(spec.input.prompt).toContain(`[${IN1}] 2026-09-30 (reflection) the operator wrote:`)
    expect(spec.input.prompt).toContain(`[${IN2}] 2026-09-30 (reflection) an agent recorded:`)
  })
})

describe('belief_extract apply', () => {
  async function job() {
    const [spec] = await beliefExtractHandler.plan(USER, NIGHT)
    return jobFrom(spec)
  }
  const claim = (over: Record<string, unknown>) => ({
    claim: 'Ship small', domain: 'Aeon', reasons: ['fast feedback'], falsifier: 'regressions', provenance: [IN1],
    relation: 'new', targetId: null, confidence: 0.8, ...over,
  })

  it('writes new / replacing beliefs and reinforcements in one call with grounded ids', async () => {
    const j = await job()
    const out = await beliefExtractHandler.apply(j, json({ beliefs: [
      claim({ relation: 'replaces', targetId: HELD.slice(0, 8), provenance: [IN1, 'invented'] }),
      claim({ claim: 'Quality first, still', relation: 'reinforces', targetId: HELD, provenance: [IN2] }),
      claim({ claim: 'Rest matters', domain: 'Narnia', provenance: [IN2] }),
    ] }), 'routine')

    expect(out).toEqual({ ok: true, memoryIds: ['new-1'] })
    expect(data.writeAlignedBeliefs).toHaveBeenCalledTimes(1)
    const [uid, runId, key, writes] = data.writeAlignedBeliefs.mock.calls[0]
    expect([uid, runId, key]).toEqual([USER, j.id, 'belief_extract:2026-10-01'])
    expect(writes.reinforce).toEqual([]) // moot: the same answer replaces HELD
    expect(writes.create).toHaveLength(2)
    const [replace, fresh] = writes.create
    expect(replace.supersedes).toBe(HELD)
    expect(replace.values.sourceMetadata).toMatchObject({
      kind: 'belief',
      extractKey: 'belief_extract:2026-10-01',
      belief: { mind: 'aligned', sourceType: 'operator', provenance: [IN1], supersedes: HELD, dominionId: 'dom-1', status: 'held' },
    })
    expect(replace.values.streamClass).toBe('belief')
    expect(fresh.supersedes).toBeNull()
    expect(fresh.values.sourceMetadata.belief).toMatchObject({ domain: 'general', dominionId: null })
  })

  it('the server, not the model, sets sourceType from provenance origins and caps confidence', async () => {
    data.listMemoryOrigins.mockResolvedValue(new Map([[IN1, 'kairos']]))
    const out = await beliefExtractHandler.apply(await job(), json({ beliefs: [claim({ confidence: 0.95, sourceType: 'operator' })] }), 'routine')
    expect(out.ok).toBe(true)
    const belief = data.writeAlignedBeliefs.mock.calls[0][3].create[0].values.sourceMetadata.belief
    expect(belief).toMatchObject({ sourceType: 'inference', confidence: 0.6 })
  })

  it('caps an agent-recorded belief at the tool ceiling and passes reinforcement confidence for server capping', async () => {
    data.listMemoryOrigins.mockResolvedValue(new Map([[IN1, 'agent']]))
    await beliefExtractHandler.apply(await job(), json({ beliefs: [
      claim({ confidence: 0.9 }),
      claim({ claim: 'Quality first', relation: 'reinforces', targetId: HELD, provenance: [IN2], confidence: 0.85 }),
    ] }), 'routine')
    const writes = data.writeAlignedBeliefs.mock.calls[0][3]
    expect(writes.create[0].values.sourceMetadata.belief).toMatchObject({ sourceType: 'tool', confidence: 0.8 })
    expect(writes.reinforce[0]).toMatchObject({ targetId: HELD, provenance: [IN2], confidence: 0.85 })
  })

  it('passes a retire only for a flagged belief; reaffirming wins over retiring the same belief', async () => {
    data.listFlaggedAlignedBeliefs.mockResolvedValue([flagged(), flagged(OWN)])
    data.listBeliefEvidence.mockResolvedValue([signal(EVID, '2026-09-20T08:00:00Z')])
    const j = await job()
    await beliefExtractHandler.apply(j, json({
      beliefs: [claim({ claim: 'Deep work mornings', relation: 'reinforces', targetId: OWN, provenance: [EVID] })],
      retire: [
        { targetId: FLAG.slice(0, 8), reason: 'operator moved to evenings' },
        { targetId: HELD, reason: 'not flagged' },
        { targetId: OWN, reason: 'also reaffirmed' },
      ],
    }), 'routine')
    const writes = data.writeAlignedBeliefs.mock.calls[0][3]
    expect(writes.retire).toEqual([{ targetId: FLAG, reason: 'operator moved to evenings' }])
    expect(writes.reinforce[0]).toMatchObject({ targetId: OWN, provenance: [EVID] })
  })

  it('accepts a retire-only answer on a flags-only job', async () => {
    data.listOperatorSignals.mockResolvedValue([])
    data.listFlaggedAlignedBeliefs.mockResolvedValue([flagged()])
    data.writeAlignedBeliefs.mockResolvedValue({ written: true, created: [], superseded: [], reinforced: [], retired: [FLAG], refusedReplaces: [] })
    const out = await beliefExtractHandler.apply(await job(), json({ beliefs: [], retire: [{ targetId: FLAG, reason: 'stale' }] }), 'routine')
    expect(out).toEqual({ ok: true, memoryIds: [FLAG] })
  })

  it('rejects ungrounded or malformed answers without writing', async () => {
    const j = await job()
    const bad = await beliefExtractHandler.apply(j, json({ beliefs: [claim({ provenance: ['nope'] })] }), 'routine')
    expect(bad).toMatchObject({ ok: false })
    expect((await beliefExtractHandler.apply(j, 'not json', 'routine')).ok).toBe(false)
    expect(data.writeAlignedBeliefs).not.toHaveBeenCalled()
  })

  it('fallback: paid heavy key, then the same apply path', async () => {
    const ask = vi.fn().mockResolvedValue({ text: json({ beliefs: [claim({})] }) })
    data.getProviderForUser.mockResolvedValue({ ask })
    const out = await beliefExtractHandler.fallback(await job())
    expect(data.getProviderForUser).toHaveBeenCalledWith(USER, 'heavy')
    expect(out.ok).toBe(true)
    expect(data.writeAlignedBeliefs.mock.calls[0][3].create[0].values.sourceMetadata.answeredBy).toBe('api')
  })

  it('fallback without a key declines', async () => {
    data.getProviderForUser.mockRejectedValue(new AiCredentialMissingError('none' as never))
    expect(await beliefExtractHandler.fallback(await job())).toEqual({ ok: false, reason: 'no BYOK credential' })
  })
})

describe('mind_compare', () => {
  it('plans only on Mondays from 04:00 UTC with both minds non-empty', async () => {
    expect(await mindCompareHandler.plan(USER, new Date('2026-10-05T03:59:00Z'))).toEqual([])
    expect(await mindCompareHandler.plan(USER, NIGHT)).toEqual([])
    data.listHeldBeliefs.mockResolvedValueOnce([])
    expect(await mindCompareHandler.plan(USER, MONDAY)).toEqual([])
  })

  it('pairs same-topic beliefs and writes one grounded observation', async () => {
    const [spec] = await mindCompareHandler.plan(USER, MONDAY)
    expect(spec).toMatchObject({ kind: 'mind_compare', externalKey: 'mind_compare:2026-W41', deadlineMinutes: 180 })
    expect(spec.input.context).toMatchObject({ pairs: [{ alignedId: HELD, ownId: OWN }], alignedOnly: [], ownOnly: [OWN2] })

    const out = await mindCompareHandler.apply(jobFrom(spec), json({
      pairs: [{ alignedId: HELD, ownId: OWN, verdict: 'agree', note: 'Both put quality first' }, { alignedId: HELD, ownId: OWN2, verdict: 'diverge', note: 'invented pair' }],
      alignedOnly: [],
      ownOnly: [OWN2, 'invented'],
    }), 'routine')

    expect(out).toEqual({ ok: true, memoryIds: ['cmp-1'] })
    const [uid, values] = data.writeMindCompare.mock.calls[0]
    expect(uid).toBe(USER)
    expect(values.externalKey).toBe('mind_compare:2026-W41')
    expect(values.sourceMetadata).toMatchObject({
      pairs: [{ alignedId: HELD, ownId: OWN, verdict: 'agree', note: 'Both put quality first' }],
      alignedOnly: [],
      ownOnly: [OWN2],
      weekKey: '2026-W41',
    })
    expect(values.bodyMd).toContain('Quality first ↔ Quality matters most')
  })

  it('rejects an answer that labels no listed pair', async () => {
    const [spec] = await mindCompareHandler.plan(USER, MONDAY)
    const out = await mindCompareHandler.apply(jobFrom(spec), json({ pairs: [], alignedOnly: [], ownOnly: [] }), 'routine')
    expect(out.ok).toBe(false)
    expect(data.writeMindCompare).not.toHaveBeenCalled()
  })
})
