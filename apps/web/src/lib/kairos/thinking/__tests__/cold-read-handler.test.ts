import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({ getChatThread: vi.fn() }))
vi.mock('@/lib/data/cold-reads', () => ({ findColdRead: vi.fn(), insertColdRead: vi.fn() }))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: vi.fn() }))

import { insertColdRead, findColdRead } from '@/lib/data/cold-reads'
import { getChatThread } from '@/lib/data/kairos-chat'
import { listJobs } from '@/lib/data/thinking-jobs'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import { routineAllows } from '@/lib/kairos/routines/catalog'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { COLD_READ_DAILY_CAP, coldReadHandler, coldReadKey, isDecisionTurn } from '../handlers/cold-read'

const USER = 'user-1'
const NOW = new Date('2026-10-03T13:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

function row(over: Partial<ThinkingJobRow>): ThinkingJobRow {
  return {
    id: 'job', userId: USER, kind: 'chat', dominionId: null, externalKey: 'k', status: 'done',
    input: { system: 's', prompt: 'p' }, output: null, claimedBy: 'routine', claimToken: null, claimedAt: null,
    deadlineAt: NOW, completedAt: NOW, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  }
}

function chatJob(id: string, body: string, ageMin: number, stance: unknown = { value: 'endorse', gist: `gist ${id}` }): ThinkingJobRow {
  return row({
    id,
    externalKey: `chat:t-${id}:m`,
    createdAt: minutesAgo(ageMin),
    input: { system: 'KAIROS PERSONA', prompt: 'transcript', context: { channel: 'web', threadId: `t-${id}`, userSeq: 3, userBody: body } },
    output: stance === null ? { answeredBy: 'routine' } : { stance, answeredBy: 'routine' },
  })
}

function coldJob(chatJobId: string, ageMin: number): ThinkingJobRow {
  return row({ id: `cold-${chatJobId}`, kind: 'cold_read', externalKey: coldReadKey(chatJobId), createdAt: minutesAgo(ageMin) })
}

let chatJobs: ThinkingJobRow[]
let coldJobs: ThinkingJobRow[]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_COLD_READ', 'audit')
  chatJobs = []
  coldJobs = []
  vi.mocked(listJobs).mockImplementation(async (_u, f) => (f?.kind === 'chat' ? chatJobs : coldJobs))
  vi.mocked(getChatThread).mockImplementation(async (_u, threadId) => ({
    thread: { id: threadId, dominionId: null, dominionName: null, title: 't', status: 'running', createdAt: NOW, lastMessageAt: null, messageCount: 4 },
    messages: [
      { id: 'm1', threadId, seq: 1, role: 'user', content: 'I have three months of savings [[aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]]', citations: [], retrieval: null, model: null, createdAt: NOW },
      { id: 'm2', threadId, seq: 2, role: 'assistant', content: 'KAIROS REPLY you always overthink', citations: [], retrieval: null, model: null, createdAt: NOW },
      { id: 'm3', threadId, seq: 3, role: 'user', content: 'Should I quit Monday?', citations: [], retrieval: null, model: null, createdAt: NOW },
      { id: 'm4', threadId, seq: 4, role: 'user', content: 'LATER MESSAGE', citations: [], retrieval: null, model: null, createdAt: NOW },
    ],
  }))
  vi.mocked(findColdRead).mockResolvedValue(null)
  vi.mocked(insertColdRead).mockResolvedValue({ memoryId: 'mem-1', written: true })
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'speak-1', delivered: { inbox: true, telegram: true } } })
})

afterEach(() => vi.unstubAllEnvs())

describe('cold read plan', () => {
  it('flag off → nothing, and no queries', async () => {
    vi.stubEnv('KAIROS_COLD_READ', '')
    chatJobs = [chatJob('a', 'Should I quit?', 10)]
    expect(await coldReadHandler.plan(USER, NOW)).toEqual([])
    expect(listJobs).not.toHaveBeenCalled()
  })

  it('picks tagged done chat jobs within 24h, decision turns first then newest, keyed per chat job', async () => {
    chatJobs = [
      chatJob('new', 'what is on today', 5),
      chatJob('untagged', 'Should I hire her?', 6, null),
      chatJob('decision', 'I\'ve decided to move the launch', 60),
      chatJob('old', 'Should I sell?', 25 * 60),
      chatJob('mid', 'thoughts on the plan', 30),
    ]
    const specs = await coldReadHandler.plan(USER, NOW)
    expect(specs.map((s) => s.externalKey)).toEqual(['cold_read:decision', 'cold_read:new', 'cold_read:mid'])
    expect(specs[0]).toMatchObject({ kind: 'cold_read', dominionId: null, deadlineMinutes: 18 * 60 })
    expect(specs[0]?.input.context).toEqual({
      chatJobId: 'decision', threadId: 't-decision', userSeq: 3, channel: 'web',
      warm: { value: 'endorse', gist: 'gist decision' }, askedAt: minutesAgo(60).toISOString(),
    })
  })

  it('caps at 3 a day, counting cold reads already planned since London midnight', async () => {
    chatJobs = ['a', 'b', 'c', 'd'].map((id, i) => chatJob(id, 'Should I?', 10 + i))
    coldJobs = [coldJob('x', 30), coldJob('y', 23 * 60)]
    const specs = await coldReadHandler.plan(USER, NOW)
    expect(specs).toHaveLength(COLD_READ_DAILY_CAP - 1)
  })

  it('never re-plans a chat job that already has a cold read', async () => {
    chatJobs = [chatJob('a', 'Should I?', 10), chatJob('b', 'Should I?', 20)]
    coldJobs = [coldJob('a', 5)]
    expect((await coldReadHandler.plan(USER, NOW)).map((s) => s.externalKey)).toEqual(['cold_read:b'])
  })

  it('the prompt carries only the owner\'s own earlier messages and this one — no Kairos replies, ids or persona', async () => {
    chatJobs = [chatJob('a', 'Should I quit Monday?', 10)]
    const [spec] = await coldReadHandler.plan(USER, NOW) as [ThinkingJobSpec]
    expect(spec.input.prompt).toContain('I have three months of savings')
    expect(spec.input.prompt).toContain('Should I quit Monday?')
    expect(spec.input.prompt).not.toContain('KAIROS REPLY')
    expect(spec.input.prompt).not.toContain('LATER MESSAGE')
    expect(spec.input.prompt).not.toContain('[[')
    expect(spec.input.system).not.toContain('KAIROS PERSONA')
    expect(spec.input.validMemoryIds).toEqual([])
  })

  it('detects decision phrasing', () => {
    expect(isDecisionTurn('So, agree?')).toBe(true)
    expect(isDecisionTurn('I\'m going to sign')).toBe(true)
    expect(isDecisionTurn('what\'s on the board')).toBe(false)
  })
})

const coldAnswer = (stance: string, confidence = 0.8) => JSON.stringify({
  restated: 'A person plans to quit a job with three months of savings.',
  stance,
  verdict: stance === 'insufficient' ? '' : 'Too little runway.',
  reasons: stance === 'insufficient' ? [] : ['Short runway'],
  confidence,
})

function coldReadJob(warm = 'endorse', askedMinAgo = 30): ThinkingJobRow {
  return row({
    id: 'cold-1', kind: 'cold_read', externalKey: coldReadKey('chat-1'), status: 'claimed',
    input: {
      system: 's', prompt: 'p',
      context: {
        chatJobId: 'chat-1', threadId: 't-1', userSeq: 3, channel: 'telegram',
        warm: { value: warm, gist: 'quit Monday' }, askedAt: new Date(Date.now() - askedMinAgo * 60_000).toISOString(),
      },
    },
  })
}

const recorded = () => vi.mocked(insertColdRead).mock.calls[0]?.[1].coldRead

describe('cold read apply', () => {
  it('audit mode records a disagreement without speaking', async () => {
    const out = await coldReadHandler.apply(coldReadJob(), coldAnswer('against'), 'routine')
    expect(out).toEqual({ ok: true, memoryIds: ['mem-1'], output: { status: 'ok', disagree: true, delivered: 'audit', answeredBy: 'routine' } })
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(insertColdRead).toHaveBeenCalledWith(USER, expect.objectContaining({ externalKey: 'cold_read:chat-1' }))
    expect(recorded()).toMatchObject({ warm: { value: 'endorse' }, cold: { stance: 'against' }, gap: 4, disagree: true, delivered: 'audit' })
  })

  it('mode 1 speaks a Second look on disagreement through the normal speak path', async () => {
    vi.stubEnv('KAIROS_COLD_READ', '1')
    const out = await coldReadHandler.apply(coldReadJob(), coldAnswer('against'), 'routine')
    expect(out).toMatchObject({ ok: true, output: { delivered: 'sent' } })
    expect(deliverKairosSpeak).toHaveBeenCalledWith(USER, expect.objectContaining({
      title: 'Second look',
      kind: 'notify',
      urgency: 'normal',
      force: false,
      externalId: 'cold-read:chat-1',
      message: expect.stringMatching(/^Second look: with your history in mind I was for it; .*advise against it: Too little runway\./),
    }))
  })

  it('records a throttled speak as blocked', async () => {
    vi.stubEnv('KAIROS_COLD_READ', '1')
    vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 429, body: { error: 'throttled' } })
    await coldReadHandler.apply(coldReadJob(), coldAnswer('against'), 'routine')
    expect(recorded()).toMatchObject({ delivered: 'blocked' })
  })

  it.each([
    ['agreement', coldReadJob(), coldAnswer('lean_endorse'), 'agree'],
    ['low confidence', coldReadJob(), coldAnswer('against', 0.5), 'agree'],
    ['a stale turn', coldReadJob('endorse', 13 * 60), coldAnswer('against'), 'stale'],
    ['insufficient', coldReadJob(), coldAnswer('insufficient'), 'insufficient'],
    ['an unreadable answer', coldReadJob(), 'I think it is fine', 'unparsed'],
  ])('mode 1 does not speak on %s', async (_label, job, text, delivered) => {
    vi.stubEnv('KAIROS_COLD_READ', '1')
    const out = await coldReadHandler.apply(job, text, 'routine')
    expect(out).toMatchObject({ ok: true, output: { delivered } })
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
    expect(insertColdRead).toHaveBeenCalledTimes(1)
  })

  it('stores an unreadable answer as unparsed, not a failed job', async () => {
    const out = await coldReadHandler.apply(coldReadJob(), 'nope', 'routine')
    expect(out).toMatchObject({ ok: true, output: { status: 'unparsed' } })
    expect(recorded()).toMatchObject({ status: 'unparsed', cold: null })
  })

  it('is idempotent: an existing row means no second write or speak', async () => {
    vi.stubEnv('KAIROS_COLD_READ', '1')
    vi.mocked(findColdRead).mockResolvedValue({ id: 'mem-0', externalKey: 'cold_read:chat-1', coldRead: {}, createdAt: NOW })
    const out = await coldReadHandler.apply(coldReadJob(), coldAnswer('against'), 'routine')
    expect(out).toMatchObject({ ok: true, memoryIds: ['mem-0'] })
    expect(insertColdRead).not.toHaveBeenCalled()
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('rejects a job without context', async () => {
    expect(await coldReadHandler.apply(row({ kind: 'cold_read' }), coldAnswer('against'), 'routine')).toMatchObject({ ok: false })
  })

  it('has no fallback', async () => {
    expect(await coldReadHandler.fallback(coldReadJob())).toMatchObject({ ok: false })
    expect(insertColdRead).not.toHaveBeenCalled()
  })
})

describe('cold read routing', () => {
  it('only the brain routine answers it', () => {
    expect(routineAllows('brain', 'cold_read')).toBe(true)
    expect(routineAllows('chat', 'cold_read')).toBe(false)
    expect(routineAllows('pulse', 'cold_read')).toBe(false)
  })
})
