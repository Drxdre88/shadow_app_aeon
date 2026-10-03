import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const afterTasks: Array<() => Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: (task: () => Promise<unknown>) => { afterTasks.push(task) },
}))

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/kairos-chat', () => ({
  appendChatMessage: vi.fn(),
  getChatThread: vi.fn(),
}))

vi.mock('@/lib/data/thinking-jobs', () => ({
  failJob: vi.fn(),
  findJobById: vi.fn(),
  listJobs: vi.fn(),
  mergeJobOutput: vi.fn(async () => true),
  upsertJob: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn', () => ({
  buildAssistantTurn: vi.fn(),
  isTurnAnswered: vi.fn(async () => false),
  persistAssistantReplyOnce: vi.fn(),
  resolvePendingAskForTurn: vi.fn(),
  runAssistantTurnOnce: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn-reply', () => ({
  appendAssistantReplyOnce: vi.fn(),
}))

vi.mock('@/lib/kairos/paid-backup', () => ({
  isPaidBackupEnabled: vi.fn(async () => true),
  PAID_BACKUP_OFF_NOTE: 'paid backup off',
}))

vi.mock('@/lib/kairos/chat-today', () => ({
  recordChatOwnerTurn: vi.fn(),
}))

import { recordChatOwnerTurn } from '@/lib/kairos/chat-today'
import { appendChatMessage, getChatThread } from '@/lib/data/kairos-chat'
import { failJob, findJobById, listJobs, mergeJobOutput, upsertJob } from '@/lib/data/thinking-jobs'
import { buildAssistantTurn, runAssistantTurnOnce } from '@/lib/kairos/chat-turn'
import { appendAssistantReplyOnce } from '@/lib/kairos/chat-turn-reply'
import { isPaidBackupEnabled } from '@/lib/kairos/paid-backup'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { CHAT_PAID_BACKUP_OFF_MESSAGE } from '../chat-routine'
import { sendWebChatViaRoutine, webChatRoutineReady } from '../chat-web-routine'

const USER = 'user-1'
const THREAD = 'thread-1'
const JOB_ID = 'job-1'
const ENV = {
  KAIROS_CHAT_ROUTINE: '1',
  ROUTINE_CHAT_ID: 'trig_chat',
  ROUTINE_CHAT_TOKEN: 'routine-token',
  KAIROS_CHAT_ROUTINE_TIMEOUT_MS: '40',
  KAIROS_CHAT_ROUTINE_POLL_MS: '5',
}

type Msg = { id: string; seq: number; role: 'user' | 'assistant'; content: string }
function thread(messages: Msg[]) {
  return {
    thread: {
      id: THREAD, dominionId: null, dominionName: null, title: 'web', status: 'running',
      createdAt: new Date(), lastMessageAt: null, messageCount: messages.length,
    },
    messages: messages.map((m) => ({ ...m, threadId: THREAD, citations: [], retrieval: null, model: null, createdAt: new Date() })),
  }
}

let lastJob: ThinkingJobRow
const job = (status: ThinkingJobRow['status'], error: string | null = null): ThinkingJobRow => ({ ...lastJob, status, error })

let fetchMock: ReturnType<typeof vi.fn>
const fireCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.anthropic.com/'))
const telegramCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('api.telegram.org'))

async function drainAfter() {
  while (afterTasks.length) await afterTasks.shift()!()
}

beforeEach(() => {
  vi.clearAllMocks()
  afterTasks.length = 0
  Object.assign(process.env, ENV)
  process.env.TELEGRAM_BOT_TOKEN = 'bot'
  fetchMock = vi.fn(async (url: string) => (String(url).startsWith('https://api.anthropic.com/')
    ? { ok: true, status: 200, text: async () => JSON.stringify({ type: 'routine_fire' }) }
    : { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(getChatThread).mockResolvedValue(thread([]))
  vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'msg-1', seq: 1 })
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(buildAssistantTurn).mockResolvedValue({
    ok: true,
    turn: {
      system: 'You are Kairos.',
      messages: [{ role: 'system', content: 'You are Kairos.' }, { role: 'user', content: 'status of hydra?' }],
      citationsContext: { retrieved: null },
      pendingAsk: null,
    },
  })
  vi.mocked(upsertJob).mockImplementation(async (userId, spec) => {
    lastJob = {
      id: JOB_ID, userId, kind: spec.kind, dominionId: null, externalKey: spec.externalKey,
      status: 'queued', input: spec.input, output: null, claimedBy: null, claimToken: null,
      claimedAt: null, deadlineAt: new Date(Date.now() + spec.deadlineMinutes * 60_000),
      completedAt: null, attempts: 0, error: null, createdAt: new Date(), updatedAt: new Date(),
    }
    return lastJob
  })
  vi.mocked(runAssistantTurnOnce).mockResolvedValue({
    ok: true, threadId: THREAD, userSeq: 1, assistantSeq: 2, assistantContent: 'Paid answer.', model: 'paid',
  })
  vi.mocked(appendAssistantReplyOnce).mockResolvedValue({ ok: true, messageId: 'a-2', seq: 2 })
  vi.mocked(isPaidBackupEnabled).mockResolvedValue(true)
})

afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  delete process.env.KAIROS_TELEGRAM_ROUTINE
  delete process.env.TELEGRAM_BOT_TOKEN
  vi.unstubAllGlobals()
})

describe('webChatRoutineReady', () => {
  it('needs the flag (either name) and the routine trigger', () => {
    expect(webChatRoutineReady()).toBe(true)
    delete process.env.KAIROS_CHAT_ROUTINE
    expect(webChatRoutineReady()).toBe(false)
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    expect(webChatRoutineReady()).toBe(true)
    delete process.env.ROUTINE_CHAT_TOKEN
    expect(webChatRoutineReady()).toBe(false)
  })
})

describe('sendWebChatViaRoutine', () => {
  it('persists the turn, queues a web chat job and returns pending before the routine is fired', async () => {
    const out = await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')

    expect(out).toEqual({ ok: true, pending: true, threadId: THREAD, userSeq: 1 })
    expect(appendChatMessage).toHaveBeenCalledWith(USER, THREAD, { role: 'user', content: 'status of hydra?' })
    expect(buildAssistantTurn).toHaveBeenCalledWith(USER, THREAD, expect.objectContaining({ userSeq: 1, surface: 'app' }))
    expect(upsertJob).toHaveBeenCalledWith(USER, expect.objectContaining({ kind: 'chat', externalKey: `chat:${THREAD}:msg-1` }))
    expect(lastJob.input.context).toMatchObject({ channel: 'web', threadId: THREAD, userSeq: 1 })
    expect(lastJob.input.context).not.toHaveProperty('chatId')
    expect(fireCalls()).toHaveLength(0)
    expect(afterTasks).toHaveLength(1)
    // One mind: the owner's web turn is logged once, operator origin from the channel.
    expect(recordChatOwnerTurn).toHaveBeenCalledTimes(1)
    expect(recordChatOwnerTurn).toHaveBeenCalledWith(USER, THREAD, 1, 'status of hydra?', 'web')
  })

  it('fires the routine in after(); the routine answering in time means no paid call', async () => {
    vi.mocked(findJobById)
      .mockImplementationOnce(async () => job('queued'))
      .mockImplementation(async () => job('done'))

    await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')
    await drainAfter()

    expect(fireCalls()).toHaveLength(1)
    expect(fireCalls()[0][0]).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_chat/fire')
    expect(failJob).not.toHaveBeenCalled()
    expect(runAssistantTurnOnce).not.toHaveBeenCalled()
    expect(telegramCalls()).toHaveLength(0)
    // The settled turn is stamped with its timing.
    expect(mergeJobOutput).toHaveBeenCalledTimes(1)
    const [, stampedId, patch] = vi.mocked(mergeJobOutput).mock.calls[0]!
    expect(stampedId).toBe(JOB_ID)
    expect(patch.timing).toMatchObject({ channel: 'web', fireOk: true, outcome: 'answered', fireMs: expect.any(Number) })
    expect((patch.timing as { messageToEnqueueMs?: number }).messageToEnqueueMs).toEqual(expect.any(Number))
  })

  it('falls back on the paid key after the timeout, on the app surface, never via Telegram', async () => {
    vi.mocked(findJobById).mockImplementation(async () => job('queued'))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _t, error) => job('failed', error))

    await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')
    await drainAfter()

    expect(failJob).toHaveBeenCalledWith(USER, JOB_ID, null, expect.stringContaining('chat-watchdog:'))
    expect(isPaidBackupEnabled).toHaveBeenCalledWith(USER)
    expect(runAssistantTurnOnce).toHaveBeenCalledWith(USER, THREAD, null, 'status of hydra?', 1, { surface: 'app' })
    expect(telegramCalls()).toHaveLength(0)
  })

  it('with the paid backup off, writes the Max-plan notice to the thread instead of a paid answer', async () => {
    vi.mocked(isPaidBackupEnabled).mockResolvedValue(false)
    vi.mocked(findJobById).mockImplementation(async () => job('queued'))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _t, error) => job('failed', error))

    await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')
    await drainAfter()

    expect(runAssistantTurnOnce).not.toHaveBeenCalled()
    expect(appendAssistantReplyOnce).toHaveBeenCalledWith(USER, THREAD, 1, { content: CHAT_PAID_BACKUP_OFF_MESSAGE })
    expect(telegramCalls()).toHaveLength(0)
  })

  it('a failed fire takes the job over at once', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('https://api.anthropic.com/')
      ? { ok: false, status: 401, text: async () => 'bad token' }
      : { ok: true, status: 200, json: async () => ({}) }))
    vi.mocked(failJob).mockImplementation(async (_u, _id, _t, error) => job('failed', error))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')
    await drainAfter()
    consoleError.mockRestore()

    // No watchdog polling: the only read is the timing stamp after settle.
    expect(findJobById).toHaveBeenCalledTimes(1)
    expect(failJob).toHaveBeenCalledWith(USER, JOB_ID, null, expect.stringContaining('fire failed (401)'))
    expect(runAssistantTurnOnce).toHaveBeenCalledTimes(1)
    expect(vi.mocked(mergeJobOutput).mock.calls[0]![2].timing).toMatchObject({ channel: 'web', fireOk: false, outcome: 'fallback' })
  })

  it('a double submit of an in-flight turn is not persisted or queued again', async () => {
    vi.mocked(getChatThread).mockResolvedValue(thread([{ id: 'msg-1', seq: 1, role: 'user', content: 'status of hydra?' }]))
    vi.mocked(listJobs).mockImplementation(async (_u, filter) => (filter?.status === 'queued'
      ? [{ externalKey: `chat:${THREAD}:msg-1` } as ThinkingJobRow]
      : []))

    const out = await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')

    expect(out).toEqual({ ok: true, pending: true, threadId: THREAD, userSeq: 1 })
    expect(appendChatMessage).not.toHaveBeenCalled()
    expect(upsertJob).not.toHaveBeenCalled()
    expect(afterTasks).toHaveLength(0)
  })

  it('retrying an unanswered turn re-queues it without posting the message twice', async () => {
    vi.mocked(getChatThread).mockResolvedValue(thread([{ id: 'msg-7', seq: 7, role: 'user', content: 'status of hydra?' }]))

    const out = await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')

    expect(out).toEqual({ ok: true, pending: true, threadId: THREAD, userSeq: 7 })
    expect(appendChatMessage).not.toHaveBeenCalled()
    expect(upsertJob).toHaveBeenCalledWith(USER, expect.objectContaining({ externalKey: `chat:${THREAD}:msg-7` }))
  })

  it('when the old turn already had a (closed) job, the retry is posted as a new message', async () => {
    vi.mocked(getChatThread).mockResolvedValue(thread([{ id: 'msg-7', seq: 7, role: 'user', content: 'status of hydra?' }]))
    vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'msg-8', seq: 8 })
    const realUpsert = vi.mocked(upsertJob).getMockImplementation()!
    vi.mocked(upsertJob).mockResolvedValueOnce(null).mockImplementation(realUpsert)

    const out = await sendWebChatViaRoutine(USER, THREAD, 'status of hydra?')

    expect(out).toEqual({ ok: true, pending: true, threadId: THREAD, userSeq: 8 })
    expect(appendChatMessage).toHaveBeenCalledTimes(1)
    expect(upsertJob).toHaveBeenLastCalledWith(USER, expect.objectContaining({ externalKey: `chat:${THREAD}:msg-8` }))
    expect(afterTasks).toHaveLength(1)
  })

  it('a missing thread is reported, nothing queued', async () => {
    vi.mocked(getChatThread).mockResolvedValue(null)
    expect(await sendWebChatViaRoutine(USER, THREAD, 'hi')).toEqual({ ok: false, reason: 'thread_not_found' })
    expect(upsertJob).not.toHaveBeenCalled()
  })
})
