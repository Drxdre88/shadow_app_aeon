import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({ safeAuth: vi.fn() }))

vi.mock('@/lib/data/kairos-chat', () => ({
  createChatThread: vi.fn(),
  getChatThread: vi.fn(),
  listChatThreads: vi.fn(),
  archiveChatThread: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-turn', () => ({
  runChatTurn: vi.fn(),
  sendChatMessage: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-web-routine', () => ({
  webChatRoutineReady: vi.fn(),
  sendWebChatViaRoutine: vi.fn(),
}))

import { safeAuth } from '@/lib/actions/helpers'
import { createChatThread } from '@/lib/data/kairos-chat'
import { runChatTurn, sendChatMessage } from '@/lib/kairos/chat-turn'
import { sendWebChatViaRoutine, webChatRoutineReady } from '@/lib/kairos/chat-web-routine'
import { sendKairosMessage, startKairosThread } from '../kairos-chat'

const USER = 'user-1'
const THREAD = 'a0000000-0000-4000-8000-000000000001'
const PENDING = { ok: true as const, pending: true as const, threadId: THREAD, userSeq: 3 }
const ANSWERED = { ok: true as const, threadId: THREAD, userSeq: 3, assistantSeq: 4, assistantContent: 'Hi.', model: 'paid' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(safeAuth).mockResolvedValue({ ok: true, userId: USER })
  vi.mocked(createChatThread).mockResolvedValue({ ok: true, threadId: THREAD })
  vi.mocked(sendWebChatViaRoutine).mockResolvedValue(PENDING)
  vi.mocked(sendChatMessage).mockResolvedValue(ANSWERED)
  vi.mocked(runChatTurn).mockResolvedValue(ANSWERED)
})

describe('web chat actions — Max-plan routine routing', () => {
  it('routine ready: sendKairosMessage queues the turn and returns pending, no paid call', async () => {
    vi.mocked(webChatRoutineReady).mockReturnValue(true)
    expect(await sendKairosMessage({ threadId: THREAD, body: 'hello' })).toEqual(PENDING)
    expect(sendWebChatViaRoutine).toHaveBeenCalledWith(USER, THREAD, 'hello')
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('routine ready: startKairosThread creates the thread then queues the first turn', async () => {
    vi.mocked(webChatRoutineReady).mockReturnValue(true)
    expect(await startKairosThread({ body: 'hello' })).toEqual(PENDING)
    expect(createChatThread).toHaveBeenCalledWith(USER, { dominionId: null, title: 'hello' })
    expect(sendWebChatViaRoutine).toHaveBeenCalledWith(USER, THREAD, 'hello')
    expect(runChatTurn).not.toHaveBeenCalled()
  })

  it('flag off: both actions keep today\'s synchronous paid path', async () => {
    vi.mocked(webChatRoutineReady).mockReturnValue(false)
    expect(await sendKairosMessage({ threadId: THREAD, body: 'hello' })).toEqual(ANSWERED)
    expect(await startKairosThread({ body: 'hello' })).toEqual(ANSWERED)
    expect(sendChatMessage).toHaveBeenCalledWith(USER, THREAD, 'hello')
    expect(runChatTurn).toHaveBeenCalledWith(USER, THREAD, null, 'hello')
    expect(sendWebChatViaRoutine).not.toHaveBeenCalled()
  })

  it('an unauthenticated caller never reaches either path', async () => {
    vi.mocked(safeAuth).mockResolvedValue({ ok: false, reason: 'unauthorized' })
    vi.mocked(webChatRoutineReady).mockReturnValue(true)
    expect(await sendKairosMessage({ threadId: THREAD, body: 'hello' })).toEqual({ ok: false, reason: 'unauthorized' })
    expect(sendWebChatViaRoutine).not.toHaveBeenCalled()
  })
})
