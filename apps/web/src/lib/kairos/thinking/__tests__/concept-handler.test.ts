import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

const data = vi.hoisted(() => ({
  listConceptCandidates: vi.fn(),
  listConceptHistory: vi.fn(),
  createConceptWithOp: vi.fn(),
  updateConceptWithOp: vi.fn(),
  findDominionsByUser: vi.fn(),
  getProviderForUser: vi.fn(),
}))

vi.mock('@/lib/data/concepts', () => ({
  listConceptCandidates: data.listConceptCandidates,
  listConceptHistory: data.listConceptHistory,
  createConceptWithOp: data.createConceptWithOp,
  updateConceptWithOp: data.updateConceptWithOp,
}))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: data.findDominionsByUser }))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: data.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))

import { AiCredentialMissingError } from '@/lib/ai/router'
import { applyConcept, conceptHandler, fallbackConcept, isoWeekKey, memberSetHash } from '../handlers/concept'

const SUNDAY = new Date('2026-10-04T01:30:00Z')
const MONDAY = new Date('2026-10-05T01:30:00Z')
const USER = 'user-1'
const DOM = 'dom-1'
const ids = Array.from({ length: 5 }, (_, i) => `${i}${i}${i}${i}${i}${i}${i}${i}-0000-4000-8000-00000000000${i}`)

function candidate(i: number, streamClass = 'idea', axis = 0) {
  const embedding = new Array(8).fill(0)
  embedding[axis] = 1
  embedding[7] = 0.01 * i
  return {
    id: ids[i],
    title: `Memory ${i}`,
    aiTitle: null,
    summary: `summary ${i}`,
    type: 'note',
    streamClass,
    confidence: 0.6,
    standing: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    embedding,
  }
}

function modelText(cite = ids): string {
  const bullets = [0, 1, 2, 3, 4].map((i) => `Point ${i} [${cite[i % cite.length]}]`)
  return '```json\n' + JSON.stringify({ title: 'Shared idea', bullets }) + '\n```'
}

async function planOne() {
  const specs = await conceptHandler.plan(USER, SUNDAY)
  expect(specs).toHaveLength(1)
  return specs[0]
}

function jobFrom(spec: Awaited<ReturnType<typeof planOne>>): ThinkingJobRow {
  const now = new Date()
  return {
    id: 'job-uuid',
    userId: USER,
    kind: 'concept',
    dominionId: spec.dominionId,
    externalKey: spec.externalKey,
    status: 'claimed',
    input: spec.input,
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: now,
    deadlineAt: now,
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  data.findDominionsByUser.mockResolvedValue([
    { id: DOM, name: 'Swarm', archivedAt: null },
    { id: 'dom-archived', name: 'Old', archivedAt: new Date() },
  ])
  data.listConceptCandidates.mockResolvedValue([0, 1, 2, 3, 4].map((i) => candidate(i)))
  data.listConceptHistory.mockResolvedValue([])
  data.createConceptWithOp.mockResolvedValue({ memoryId: 'new-concept', written: true })
  data.updateConceptWithOp.mockResolvedValue({ memoryId: 'old-concept', written: true })
})

describe('concept handler plan', () => {
  it('plans nothing outside Sunday (UTC)', async () => {
    expect(await conceptHandler.plan(USER, MONDAY)).toEqual([])
    expect(data.findDominionsByUser).not.toHaveBeenCalled()
  })

  it('emits one job per cluster for active Dominions with the week/hash key', async () => {
    const spec = await planOne()
    expect(data.listConceptCandidates).toHaveBeenCalledTimes(1)
    expect(spec.kind).toBe('concept')
    expect(spec.deadlineMinutes).toBe(360)
    expect(isoWeekKey(SUNDAY)).toBe('2026-W40')
    expect(spec.externalKey).toBe(`concept:${DOM}:2026-W40:${memberSetHash(ids)}`)
    expect(spec.input.validMemoryIds).toEqual([...ids].sort())
    expect(spec.input.prompt).toContain(`[${ids[0]}]`)
    expect(spec.input.context).toMatchObject({ proposal: false, matchId: null, confidence: 0.6 })
  })

  it('skips a cluster whose member set already matches a live concept exactly', async () => {
    data.listConceptHistory.mockResolvedValue([{ id: 'c', isProposal: false, pinned: false, memberIds: ids, state: 'live' }])
    expect(await conceptHandler.plan(USER, SUNDAY)).toEqual([])
  })

  it('targets an overlapping concept for update, skips pinned ones', async () => {
    data.listConceptHistory.mockResolvedValue([{ id: 'c', isProposal: false, pinned: false, memberIds: ids.slice(0, 4), state: 'live' }])
    const spec = await planOne()
    expect(spec.input.context).toMatchObject({ matchId: 'c', overlap: 0.8 })

    data.listConceptHistory.mockResolvedValue([{ id: 'c', isProposal: false, pinned: true, memberIds: ids.slice(0, 4), state: 'live' }])
    expect(await conceptHandler.plan(USER, SUNDAY)).toEqual([])
  })

  it('marks reflection-dominated clusters as proposals', async () => {
    data.listConceptCandidates.mockResolvedValue([0, 1, 2, 3, 4].map((i) => candidate(i, i < 3 ? 'reflection' : 'idea')))
    const spec = await planOne()
    expect(spec.input.context).toMatchObject({ proposal: true })
  })

  it('never re-proposes a cluster the operator dismissed or accepted (resolved rows veto at Jaccard ≥ 0.6)', async () => {
    data.listConceptCandidates.mockResolvedValue([0, 1, 2, 3, 4].map((i) => candidate(i, i < 3 ? 'reflection' : 'idea')))
    // Dismissed proposal over 3 of 5 members + 1 outsider: Jaccard 3/6 = 0.5 → not a veto.
    data.listConceptHistory.mockResolvedValue([
      { id: 'dismissed', isProposal: true, pinned: false, memberIds: [...ids.slice(0, 3), 'outsider'], state: 'resolved' },
    ])
    expect(await conceptHandler.plan(USER, SUNDAY)).toHaveLength(1)
    // 4 of 5 members: Jaccard 0.8 → vetoed, whatever kind it was.
    data.listConceptHistory.mockResolvedValue([
      { id: 'dismissed', isProposal: false, pinned: false, memberIds: ids.slice(0, 4), state: 'resolved' },
    ])
    expect(await conceptHandler.plan(USER, SUNDAY)).toEqual([])
  })

  it('a live match still wins over an older resolved row (update in place)', async () => {
    data.listConceptHistory.mockResolvedValue([
      { id: 'live', isProposal: false, pinned: false, memberIds: ids.slice(0, 4), state: 'live' },
      { id: 'old-dismissed', isProposal: false, pinned: false, memberIds: ids.slice(0, 4), state: 'resolved' },
    ])
    const spec = await planOne()
    expect(spec.input.context).toMatchObject({ matchId: 'live', overlap: 0.8 })
  })
})

describe('concept handler apply', () => {
  it('writes a concept linked to all members with a create op', async () => {
    const job = jobFrom(await planOne())
    const out = await applyConcept(job, modelText(), 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['new-concept'] })
    const [userId, runId, values, meta] = data.createConceptWithOp.mock.calls[0]
    expect(userId).toBe(USER)
    expect(runId).toBe('job-uuid')
    expect(values).toMatchObject({
      type: 'concept',
      streamClass: 'concept',
      dominionId: DOM,
      confidence: 0.6,
      externalKey: job.externalKey,
      tags: ['concept'],
      sourceMetadata: { kind: 'concept', weekKey: '2026-W40', answeredBy: 'routine' },
    })
    expect(values.links).toHaveLength(5)
    expect(values.links[0]).toEqual({ type: 'refers_to', target: [...ids].sort()[0], target_kind: 'memory' })
    expect(values.sourceMetadata.memberIds).toEqual([...ids].sort())
    expect(meta.step).toBe('concepts')
  })

  it('rejects when fewer than three members are grounded', async () => {
    const job = jobFrom(await planOne())
    const out = await applyConcept(job, modelText([ids[0], ids[1], 'ffffffff-9999']), 'routine')
    expect(out.ok).toBe(false)
    expect(data.createConceptWithOp).not.toHaveBeenCalled()
  })

  it('does not repair on the routine path: malformed text is rejected', async () => {
    const job = jobFrom(await planOne())
    expect((await applyConcept(job, 'not json', 'routine')).ok).toBe(false)
    expect(data.getProviderForUser).not.toHaveBeenCalled()
  })

  it('updates the matched concept in place, creating fresh if the target vanished', async () => {
    data.listConceptHistory.mockResolvedValue([{ id: 'old-concept', isProposal: false, pinned: false, memberIds: ids.slice(0, 4), state: 'live' }])
    const job = jobFrom(await planOne())
    expect(await applyConcept(job, modelText(), 'routine')).toEqual({ ok: true, memoryIds: ['old-concept'] })
    expect(data.updateConceptWithOp.mock.calls[0][2]).toBe('old-concept')
    expect(data.createConceptWithOp).not.toHaveBeenCalled()

    data.updateConceptWithOp.mockResolvedValueOnce(null)
    expect(await applyConcept(job, modelText(), 'routine')).toEqual({ ok: true, memoryIds: ['new-concept'] })
  })

  it('writes operator-dominated clusters as a pending proposal', async () => {
    data.listConceptCandidates.mockResolvedValue([0, 1, 2, 3, 4].map((i) => candidate(i, i < 3 ? 'reflection' : 'idea')))
    const job = jobFrom(await planOne())
    await applyConcept(job, modelText(), 'routine')
    expect(data.createConceptWithOp.mock.calls[0][2]).toMatchObject({
      type: 'inbound',
      streamClass: 'agentic',
      tags: ['proposal', 'concept'],
      sourceMetadata: { kind: 'concept', status: 'pending' },
    })
  })

  it('rejects a job with a malformed context', async () => {
    const job = jobFrom(await planOne())
    expect(await applyConcept({ ...job, input: { ...job.input, context: {} } }, modelText(), 'routine')).toEqual({
      ok: false,
      reason: 'invalid concept job context',
    })
  })
})

describe('concept handler fallback', () => {
  it('asks the heavy tier, repairs once, then applies', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: modelText() })
    data.getProviderForUser.mockResolvedValue({ ask })
    const job = jobFrom(await planOne())
    const out = await fallbackConcept(job)
    expect(out).toEqual({ ok: true, memoryIds: ['new-concept'] })
    expect(data.getProviderForUser).toHaveBeenCalledWith(USER, 'heavy')
    expect(ask.mock.calls[0][0]).toMatchObject({ system: job.input.system, prompt: job.input.prompt })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(data.createConceptWithOp.mock.calls[0][2].sourceMetadata.answeredBy).toBe('api')
  })

  it('reports a missing BYOK credential instead of throwing', async () => {
    data.getProviderForUser.mockRejectedValue(new AiCredentialMissingError('anthropic'))
    const job = jobFrom(await planOne())
    expect(await fallbackConcept(job)).toEqual({ ok: false, reason: 'no BYOK credential' })
  })

  it('rejects when repair also fails', async () => {
    data.getProviderForUser.mockResolvedValue({ ask: vi.fn().mockResolvedValue({ text: 'still bad' }) })
    const job = jobFrom(await planOne())
    const out = await fallbackConcept(job)
    expect(out.ok).toBe(false)
    expect(data.createConceptWithOp).not.toHaveBeenCalled()
  })
})
