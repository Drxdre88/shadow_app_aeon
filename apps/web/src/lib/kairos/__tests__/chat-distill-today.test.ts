import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One mind (spec_one_mind) × chat-distill: the today log is a cache and never
// a memory source — distill output is unchanged by it. Triad dialogue threads
// join the run only behind KAIROS_DISTILL_DIALOGUES=1, never as operator origin.

vi.mock('@/lib/data/ask', () => ({ listKairosAsksAnsweredBetween: vi.fn(async () => []) }))
vi.mock('@/lib/data/kairos-chat', () => ({ listChatThreadsWithMessagesOn: vi.fn() }))
vi.mock('@/lib/data/kairos-dialogue-distill', () => ({
  DIALOGUE_ENGINE: 'kairos-dialogue',
  listDialogueThreadsWithTurnsOn: vi.fn(async () => []),
}))
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn() }))
vi.mock('@/lib/data/thinking-jobs', () => ({ isJobDone: vi.fn(async () => false) }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('../cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
// A busy today log: if the distill ever read it, these spies would fire.
vi.mock('../today', () => ({
  loadTodayDigest: vi.fn(async () => ({ entries: [{ at: '2026-07-16T10:00:00.000Z', channel: 'telegram', type: 'said', speaker: 'owner', relayed: false, text: 'I prefer Fridays.' }], from: '', to: '' })),
}))
vi.mock('@/lib/data/kairos-today', () => ({ listTodayEntries: vi.fn(async () => []) }))

import { listChatThreadsWithMessagesOn } from '@/lib/data/kairos-chat'
import { listDialogueThreadsWithTurnsOn } from '@/lib/data/kairos-dialogue-distill'
import { listTodayEntries } from '@/lib/data/kairos-today'
import { captureMemory } from '@/lib/data/memories'
import { getProviderForTask } from '@/lib/ai/route-task'
import { loadTodayDigest } from '../today'
import { gatherChatDistillThreads, runChatDistillForUser } from '../chat-distill'

const USER = 'user-1'
const DATE = '2026-07-16'
const at = new Date(`${DATE}T12:00:00.000Z`)
const msg = (threadId: string, seq: number, role: 'user' | 'assistant', content: string) =>
  ({ id: `${threadId}-${seq}`, threadId, seq, role, content, citations: [], retrieval: null, model: null, createdAt: at })

const ask = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAIROS_DISTILL_DIALOGUES
  vi.mocked(listChatThreadsWithMessagesOn).mockResolvedValue([])
  ask.mockResolvedValue({ text: JSON.stringify({ reflections: [{ title: 'Pref', bodyMd: 'I prefer Fridays.' }] }) })
  vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
  vi.mocked(captureMemory).mockImplementation(async () => ({ memory: { id: 'm1' }, created: true }) as never)
})

afterEach(() => {
  delete process.env.KAIROS_DISTILL_DIALOGUES
})

describe('chat-distill never distills the today log', () => {
  it('a day with today entries but no chat threads writes no memories and never reads the log', async () => {
    const res = await runChatDistillForUser(USER, { date: DATE })

    expect(res.reflectionsCreated).toBe(0)
    expect(captureMemory).not.toHaveBeenCalled()
    expect(loadTodayDigest).not.toHaveBeenCalled()
    expect(listTodayEntries).not.toHaveBeenCalled()
  })
})

describe('KAIROS_DISTILL_DIALOGUES', () => {
  const dialogue = {
    id: 'dlg-1',
    dominionId: null,
    title: 'Triad · drift',
    engine: 'kairos-dialogue' as const,
    messages: [msg('dlg-1', 1, 'user', 'Relayed: I prefer Fridays.'), msg('dlg-1', 2, 'assistant', 'Noted.')],
  }

  it('default off: dialogue threads are not read', async () => {
    await gatherChatDistillThreads(USER, { start: at, end: at })
    expect(listDialogueThreadsWithTurnsOn).not.toHaveBeenCalled()
  })

  it('on: dialogue threads join the run and their reflections never carry operator origin', async () => {
    process.env.KAIROS_DISTILL_DIALOGUES = '1'
    vi.mocked(listChatThreadsWithMessagesOn).mockResolvedValue([
      { id: 'chat-1', dominionId: null, title: 'Web', messages: [msg('chat-1', 1, 'user', 'Ship it.')] },
    ] as never)
    vi.mocked(listDialogueThreadsWithTurnsOn).mockResolvedValue([dialogue] as never)

    const res = await runChatDistillForUser(USER, { date: DATE })

    expect(res.threads.map((t) => t.threadId)).toEqual(['chat-1', 'dlg-1'])
    expect(vi.mocked(captureMemory).mock.calls.every(([, , opts]) => opts?.origin?.kind === 'kairos')).toBe(true)
  })
})
