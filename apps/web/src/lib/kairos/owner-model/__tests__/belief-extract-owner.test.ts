import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'

// belief_extract × owner model side section (spec_B §3.3): flag off is
// byte-identical; apply runs only on Max-plan answers and never fails the
// job; the paid fallback prompt equals flag-off.

const data = vi.hoisted(() => ({
  listHeldBeliefs: vi.fn(),
  listOperatorSignals: vi.fn(),
  listRecentExtractJobs: vi.fn(),
  listBeliefEvidence: vi.fn(),
  listMemoryOrigins: vi.fn(),
  thinkingJobKeyExists: vi.fn(),
  writeAlignedBeliefs: vi.fn(),
  findDominionsByUser: vi.fn(),
  getProviderForUser: vi.fn(),
  readKairosOwnerModel: vi.fn(),
  applyOwnerExtract: vi.fn(),
}))

vi.mock('@/lib/data/beliefs', () => ({
  listHeldBeliefs: data.listHeldBeliefs,
  listOperatorSignals: data.listOperatorSignals,
  listRecentExtractJobs: data.listRecentExtractJobs,
  listBeliefEvidence: data.listBeliefEvidence,
  listMemoryOrigins: data.listMemoryOrigins,
  thinkingJobKeyExists: data.thinkingJobKeyExists,
  writeAlignedBeliefs: data.writeAlignedBeliefs,
  SIGNAL_INPUT_CAP: 60,
}))
vi.mock('@/lib/data/belief-recheck', () => ({
  listFlaggedAlignedBeliefs: vi.fn(async () => []),
  listOpenAlignedBeliefs: vi.fn(async () => []),
  RECHECK_IN_PROMPT_CAP: 20,
}))
vi.mock('@/lib/kairos/surprise/extract-signals', () => ({ recordBeliefExtractSurprises: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({ FALLBACK_ERROR_PREFIX: 'fallback:' }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: data.findDominionsByUser }))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: data.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/data/kairos-owner-model', () => ({ readKairosOwnerModel: data.readKairosOwnerModel }))
vi.mock('@/lib/kairos/owner-model/apply', () => ({ applyOwnerExtract: data.applyOwnerExtract }))

import { EXTRACT_SYSTEM_PROMPT } from '@/lib/kairos/beliefs/extract-prompt'
import { beliefExtractHandler } from '../../thinking/handlers/belief-extract'
import { emptyOwnerModel } from '../status'

const USER = 'user-1'
const IN1 = '11111111-aaaa-4aaa-8aaa-111111111111'
const NIGHT = new Date('2026-10-01T03:00:00Z')

function jobFrom(spec: ThinkingJobSpec): ThinkingJobRow {
  const now = new Date()
  return {
    id: '99999999-0000-4000-8000-000000000009', userId: USER, kind: spec.kind, dominionId: spec.dominionId,
    externalKey: spec.externalKey, status: 'claimed', input: spec.input, output: null, claimedBy: 'routine',
    claimToken: 't', claimedAt: now, deadlineAt: now, completedAt: null, attempts: 1, error: null, createdAt: now, updatedAt: now,
  }
}

const json = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'
const answer = json({
  beliefs: [{ claim: 'Ship small', domain: 'general', reasons: [], falsifier: 'x', provenance: [IN1], relation: 'new', targetId: null, confidence: 0.7 }],
  owner: { states: [{ text: 'stressed about the launch', provenance: [IN1], relation: 'new' }] },
})

const plan = async () => (await beliefExtractHandler.plan(USER, NIGHT))[0]!

beforeEach(() => {
  vi.clearAllMocks()
  data.thinkingJobKeyExists.mockResolvedValue(false)
  data.listRecentExtractJobs.mockResolvedValue([])
  data.listOperatorSignals.mockResolvedValue([{ id: IN1, title: 't', aiTitle: null, summary: 's', bodyMd: 'b', type: 'reflection', kind: null, createdAt: new Date('2026-09-30T08:00:00Z'), origin: 'operator' }])
  data.listHeldBeliefs.mockResolvedValue([])
  data.listBeliefEvidence.mockResolvedValue([])
  data.findDominionsByUser.mockResolvedValue([])
  data.listMemoryOrigins.mockImplementation(async (_u: string, ids: string[]) => new Map(ids.map((id) => [id, 'operator'])))
  data.writeAlignedBeliefs.mockResolvedValue({ written: true, created: ['new-1'], superseded: [], reinforced: [], retired: [], refusedReplaces: [] })
  data.readKairosOwnerModel.mockResolvedValue(emptyOwnerModel())
  data.applyOwnerExtract.mockResolvedValue({ states: 1, traits: 0 })
})

afterEach(() => {
  delete process.env.KAIROS_OWNER_MODEL
})

describe('belief_extract with KAIROS_OWNER_MODEL off', () => {
  it('plans the byte-identical system, prompt and context, never reading the owner model', async () => {
    const off = await plan()
    process.env.KAIROS_OWNER_MODEL = '0'
    const zero = await plan()
    expect(zero).toEqual(off)
    expect(off.input.system).toBe(EXTRACT_SYSTEM_PROMPT)
    expect(off.input.prompt.endsWith('Extract the beliefs these inputs show the operator holds.')).toBe(true)
    expect(off.input.context).not.toHaveProperty('owner')
    expect(data.readKairosOwnerModel).not.toHaveBeenCalled()
  })

  it('apply never touches the owner model', async () => {
    await beliefExtractHandler.apply(jobFrom(await plan()), answer, 'routine')
    expect(data.applyOwnerExtract).not.toHaveBeenCalled()
  })
})

describe('belief_extract with the owner side section', () => {
  it.each(['observe', '1'])('mode %s adds the suffix + section on top of the flag-off input', async (mode) => {
    const off = await plan()
    process.env.KAIROS_OWNER_MODEL = mode
    const on = await plan()
    expect(on.input.system.startsWith(off.input.system)).toBe(true)
    expect(on.input.system.length).toBeGreaterThan(off.input.system.length)
    expect(on.input.prompt.startsWith(off.input.prompt)).toBe(true)
    expect(on.input.context).toMatchObject({ owner: { seqs: [] } })
    expect(on.externalKey).toBe(off.externalKey)
  })

  it('applies the side answer for a Max-plan answer, not for an api answer', async () => {
    process.env.KAIROS_OWNER_MODEL = 'observe'
    const j = jobFrom(await plan())
    expect(await beliefExtractHandler.apply(j, answer, 'routine')).toMatchObject({ ok: true })
    expect(data.applyOwnerExtract).toHaveBeenCalledWith(USER, { states: [{ text: 'stressed about the launch', provenance: [IN1], relation: 'new', targetSeq: null }], traits: [] }, expect.any(Date))
    data.applyOwnerExtract.mockClear()
    await beliefExtractHandler.apply(j, answer, 'api')
    expect(data.applyOwnerExtract).not.toHaveBeenCalled()
  })

  it('an owner apply that throws still leaves the job ok', async () => {
    process.env.KAIROS_OWNER_MODEL = '1'
    data.applyOwnerExtract.mockRejectedValue(new Error('db down'))
    expect(await beliefExtractHandler.apply(jobFrom(await plan()), answer, 'routine')).toEqual({ ok: true, memoryIds: ['new-1'] })
  })

  it('an owner-model read failure plans the flag-off job', async () => {
    const off = await plan()
    process.env.KAIROS_OWNER_MODEL = '1'
    data.readKairosOwnerModel.mockRejectedValue(new Error('corrupt'))
    expect(await plan()).toEqual(off)
  })

  it('the paid fallback asks with the exact flag-off prompt and never applies the side answer', async () => {
    const off = await plan()
    process.env.KAIROS_OWNER_MODEL = '1'
    const ask = vi.fn().mockResolvedValue({ text: answer })
    data.getProviderForUser.mockResolvedValue({ ask })
    const out = await beliefExtractHandler.fallback(jobFrom(await plan()))
    expect(out.ok).toBe(true)
    expect(ask.mock.calls[0][0]).toMatchObject({ system: off.input.system, prompt: off.input.prompt })
    expect(ask.mock.calls[0][0].system).toBe(off.input.system)
    expect(ask.mock.calls[0][0].prompt).toBe(off.input.prompt)
    expect(data.applyOwnerExtract).not.toHaveBeenCalled()
  })
})
