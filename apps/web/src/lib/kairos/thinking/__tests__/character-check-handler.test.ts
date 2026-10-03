import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'

const m = vi.hoisted(() => ({
  getLatestAether: vi.fn(),
  findCharacterRun: vi.fn(),
  findLatestWeeklyReviewSummary: vi.fn(),
  listCharacterRuns: vi.fn(),
  listDailyMessagesBetween: vi.fn(),
  listReflectionsBetween: vi.fn(),
  insertDriftObservation: vi.fn(),
  listChatThreadsWithMessagesOn: vi.fn(),
  hasJobWithKeyLike: vi.fn(),
  listApprovedVoiceSamples: vi.fn(),
  countPendingVoiceSamples: vi.fn(),
  insertVoiceSampleProposal: vi.fn(),
  setProposalTelegram: vi.fn(),
  sendKairosProposal: vi.fn(),
  getLiveConstitution: vi.fn(),
  askPaidAndParse: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/aether', () => ({ getLatestAether: m.getLatestAether }))
vi.mock('@/lib/data/character', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/character')>()),
  findCharacterRun: m.findCharacterRun,
  findLatestWeeklyReviewSummary: m.findLatestWeeklyReviewSummary,
  listCharacterRuns: m.listCharacterRuns,
  listDailyMessagesBetween: m.listDailyMessagesBetween,
  listReflectionsBetween: m.listReflectionsBetween,
}))
vi.mock('@/lib/data/constitution-drift', () => ({ insertDriftObservation: m.insertDriftObservation, findDriftObservation: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({ listChatThreadsWithMessagesOn: m.listChatThreadsWithMessagesOn }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike }))
vi.mock('@/lib/data/voice-samples', () => ({
  VOICE_SAMPLE_KIND: 'voice_sample',
  listApprovedVoiceSamples: m.listApprovedVoiceSamples,
  countPendingVoiceSamples: m.countPendingVoiceSamples,
  insertVoiceSampleProposal: m.insertVoiceSampleProposal,
}))
vi.mock('@/lib/data/proposal-decision', () => ({ setProposalTelegram: m.setProposalTelegram }))
vi.mock('@/lib/kairos/telegram', () => ({ sendKairosProposal: m.sendKairosProposal }))
vi.mock('@/lib/kairos/constitution/amendment', () => ({ getLiveConstitution: m.getLiveConstitution }))
vi.mock('../paid-fallback', () => ({ askPaidAndParse: m.askPaidAndParse }))

import { characterCheckHandler } from '../handlers/character-check'

const USER = 'user-1'
const MONDAY = new Date('2026-10-05T03:40:00Z')
const SCORES0 = { syc: 0, myst: 0, grand: 0, ident: 0, hedge: 0 }

interface CtxItem { id: string; source: string; ref: string; text: string }

function seed({ reflections = 4, chat = 3, anchors = 1 } = {}) {
  m.listReflectionsBetween.mockResolvedValue(Array.from({ length: reflections }, (_, i) => ({ id: `mem-r${i}`, text: `Board note ${i}`, toneFlagged: i === 0 })))
  m.listChatThreadsWithMessagesOn.mockResolvedValue([{
    id: 'thread-1', dominionId: null, title: 't',
    messages: [
      { id: 'msg-u1', role: 'user', content: 'Should I ship it?' },
      ...Array.from({ length: chat }, (_, i) => ({ id: `msg-a${i}`, role: 'assistant', content: `Answer ${i} [[mem-x]]` })),
    ],
  }])
  m.listDailyMessagesBetween.mockResolvedValue([{ id: 'mem-d1', text: 'Morning: two cards due.' }])
  m.getLatestAether.mockResolvedValue({ generatedAt: '2026-10-05T03:13:00Z', coreNarrative: 'Steady week on Swarm.' })
  m.findLatestWeeklyReviewSummary.mockResolvedValue({ id: 'mem-wr', text: 'A steady week.' })
  m.listApprovedVoiceSamples.mockResolvedValue(Array.from({ length: anchors }, (_, i) => ({ id: `mem-v${i}`, text: `Plain line ${i}`, source: 'chat' })))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_CHARACTER_CHECK = '1'
  delete process.env.KAIROS_OPERATOR_USER_ID
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.getLiveConstitution.mockResolvedValue({ id: 'c-1', version: 2, principles: [{ n: 1, text: 'Tell the truth plainly', reason: 'r' }] })
  m.findCharacterRun.mockResolvedValue(null)
  m.listCharacterRuns.mockResolvedValue([])
  m.insertDriftObservation.mockResolvedValue({ memoryId: 'mem-run', written: true })
  m.countPendingVoiceSamples.mockResolvedValue(0)
  m.insertVoiceSampleProposal.mockResolvedValue({ id: 'mem-vs', written: true })
  seed()
})
afterEach(() => { delete process.env.KAIROS_CHARACTER_CHECK })

async function planOne(now = MONDAY): Promise<ThinkingJobSpec> {
  const specs = await characterCheckHandler.plan(USER, now)
  expect(specs).toHaveLength(1)
  return specs[0]
}

function jobFrom(spec: ThinkingJobSpec): ThinkingJobRow {
  return {
    id: 'job-c', userId: USER, kind: spec.kind, dominionId: null, externalKey: spec.externalKey, status: 'claimed',
    input: spec.input, output: null, claimedBy: 'routine:brain', claimToken: 't', claimedAt: MONDAY, deadlineAt: MONDAY,
    completedAt: null, attempts: 1, error: null, createdAt: MONDAY, updatedAt: MONDAY,
  }
}

const ctxItems = (job: ThinkingJobRow) => (job.input.context as { items: CtxItem[] }).items
const answerFor = (items: CtxItem[], voiceCandidate: string | null) =>
  '```json\n' + JSON.stringify({ items: items.map((i) => ({ id: i.id, scores: SCORES0, note: 'plain' })), voiceCandidate }) + '\n```'

describe('character_check plan', () => {
  it('flag off: plans nothing and reads nothing', async () => {
    delete process.env.KAIROS_CHARACTER_CHECK
    expect(await characterCheckHandler.plan(USER, MONDAY)).toEqual([])
    expect(m.hasJobWithKeyLike).not.toHaveBeenCalled()
  })

  it.each([
    ['Monday before 03:30Z', '2026-10-05T03:29:00Z'],
    ['Tuesday', '2026-10-06T04:00:00Z'],
    ['Sunday', '2026-10-04T12:00:00Z'],
  ])('%s: nothing', async (_l, iso) => {
    expect(await characterCheckHandler.plan(USER, new Date(iso))).toEqual([])
    expect(m.hasJobWithKeyLike).not.toHaveBeenCalled()
  })

  it('one job per reviewed ISO week', async () => {
    m.hasJobWithKeyLike.mockResolvedValue(true)
    expect(await characterCheckHandler.plan(USER, MONDAY)).toEqual([])
    expect(m.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'character_check', 'character_check:2026-W40')
    expect(m.listReflectionsBetween).not.toHaveBeenCalled()
  })

  it('fewer than 6 real samples: skipped (anchors do not count)', async () => {
    seed({ reflections: 1, chat: 1, anchors: 6 })
    m.getLatestAether.mockResolvedValue(null)
    m.findLatestWeeklyReviewSummary.mockResolvedValue(null)
    expect(await characterCheckHandler.plan(USER, MONDAY)).toEqual([])
  })

  it('plans a blind, deterministic job: opaque ids in the prompt, sources only in context', async () => {
    const spec = await planOne()
    expect(spec).toMatchObject({ kind: 'character_check', dominionId: null, externalKey: 'character_check:2026-W40', deadlineMinutes: 150 })
    const items = ctxItems(jobFrom(spec))
    expect(items).toHaveLength(11)
    expect(items.filter((i) => i.source === 'exemplar')).toHaveLength(1)
    for (const i of items) expect(spec.input.prompt).toContain(`[${i.id}]`)
    for (const ref of ['mem-r0', 'msg-a0', 'mem-v0', 'mem-wr', 'mem-x']) expect(spec.input.prompt).not.toContain(ref)
    expect(spec.input.prompt).not.toMatch(/exemplar|reflection/i)
    expect(spec.input.system).not.toMatch(/Kairos|conscience/i)
    expect(spec.input.prompt).not.toContain('Should I ship it?')
    expect(spec.input.context).toMatchObject({ isoWeek: '2026-W40', toneFlags: { flagged: 1, total: 4 } })
    expect((await planOne()).input).toEqual(spec.input)
  })
})

describe('character_check apply', () => {
  it('writes one character_run trace row', async () => {
    const job = jobFrom(await planOne())
    const out = await characterCheckHandler.apply(job, answerFor(ctxItems(job), null), 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: ['mem-run'] })
    expect(m.insertDriftObservation).toHaveBeenCalledTimes(1)
    const [, values] = m.insertDriftObservation.mock.calls[0]
    expect(values).toMatchObject({ kind: 'character_run', externalKey: 'character_run:2026-W40' })
    expect(values.sourceMetadata.character).toMatchObject({
      v: 1, status: 'ok', isoWeek: '2026-W40', jobId: 'job-c', answeredBy: 'routine',
      counts: { reflection: 4, chat: 3, daily: 1, aether: 1, review: 1, exemplar: 1 },
      toneFlags: { flagged: 1, total: 4 }, breach: { tripped: false },
    })
  })

  it('is idempotent: an existing run short-circuits', async () => {
    const job = jobFrom(await planOne())
    m.findCharacterRun.mockResolvedValue({ id: 'mem-old', sourceMetadata: {}, createdAt: MONDAY })
    expect(await characterCheckHandler.apply(job, answerFor(ctxItems(job), null), 'routine')).toMatchObject({ ok: true, memoryIds: ['mem-old'] })
    expect(m.insertDriftObservation).not.toHaveBeenCalled()
  })

  it('an unreadable answer is stored as unparsed, not failed', async () => {
    const job = jobFrom(await planOne())
    const out = await characterCheckHandler.apply(job, 'I would rather not.', 'routine')
    expect(out.ok).toBe(true)
    const [, values] = m.insertDriftObservation.mock.calls[0]
    expect(values.sourceMetadata.character).toMatchObject({ status: 'unparsed', perTrait: null })
    expect(m.insertVoiceSampleProposal).not.toHaveBeenCalled()
  })

  it('files the voice candidate when fewer than 2 are pending', async () => {
    const job = jobFrom(await planOne())
    const chat = ctxItems(job).find((i) => i.source === 'chat') as CtxItem
    const out = await characterCheckHandler.apply(job, answerFor(ctxItems(job), chat.id), 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: ['mem-run', 'mem-vs'] })
    const [, input] = m.insertVoiceSampleProposal.mock.calls[0]
    expect(input).toMatchObject({ externalKey: 'voice_sample:2026-W40', text: chat.text, source: 'chat', isoWeek: '2026-W40', jobId: 'job-c' })
  })

  it('no proposal with 2 pending, or when the candidate is an anchor', async () => {
    const job = jobFrom(await planOne())
    const items = ctxItems(job)
    m.countPendingVoiceSamples.mockResolvedValue(2)
    await characterCheckHandler.apply(job, answerFor(items, (items.find((i) => i.source === 'chat') as CtxItem).id), 'routine')
    expect(m.insertVoiceSampleProposal).not.toHaveBeenCalled()

    m.countPendingVoiceSamples.mockResolvedValue(0)
    await characterCheckHandler.apply(job, answerFor(items, (items.find((i) => i.source === 'exemplar') as CtxItem).id), 'routine')
    expect(m.insertVoiceSampleProposal).not.toHaveBeenCalled()
  })

  it('fallback: not ok, never a paid call', async () => {
    const job = jobFrom(await planOne())
    expect(await characterCheckHandler.fallback(job)).toMatchObject({ ok: false })
    expect(m.askPaidAndParse).not.toHaveBeenCalled()
  })
})
