import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireAuth: vi.fn(),
  safeAuth: vi.fn(),
}))

vi.mock('@/lib/data/kairos-chat', () => ({
  createChatThread: vi.fn(),
  getChatThread: vi.fn(),
  listChatThreads: vi.fn(),
  appendChatMessage: vi.fn(),
  archiveChatThread: vi.fn(),
  updateChatMessageContent: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-retrieval', () => ({
  retrieveForChat: vi.fn(),
  extractCitationIds: (text: string) => {
    const ids: string[] = []
    const seen = new Set<string>()
    const re = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi
    for (const m of text.matchAll(re)) {
      const id = m[1].toLowerCase()
      if (!seen.has(id)) { seen.add(id); ids.push(id) }
    }
    return ids
  },
  intersectWithRetrieved: (cited: string[], retrieval: { cortex: { id: string } | null; archetypes: { id: string }[]; substrate: { id: string }[] }) => {
    const set = new Set<string>()
    if (retrieval.cortex) set.add(retrieval.cortex.id.toLowerCase())
    for (const a of retrieval.archetypes) set.add(a.id.toLowerCase())
    for (const s of retrieval.substrate) set.add(s.id.toLowerCase())
    return cited.filter((id) => set.has(id))
  },
}))

vi.mock('@/lib/ai/route-task', () => ({
  getProviderForTask: vi.fn(),
}))

vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => [{ name: 'AEON', vision: 'v', missionLong: 'm' }]),
        })),
      })),
    })),
  },
}))

import { safeAuth } from '@/lib/actions/helpers'
import {
  getChatThread as _getChatThread,
  appendChatMessage as _appendChatMessage,
  updateChatMessageContent as _updateChatMessageContent,
} from '@/lib/data/kairos-chat'
import { retrieveForChat } from '@/lib/kairos/chat-retrieval'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'
import { sendKairosMessage } from '../kairos-chat'

const USER_ID = 'user-1'
const THREAD_ID = 'a0000000-0000-4000-8000-000000000001'
const DOMINION_ID = 'b0000000-0000-4000-8000-000000000002'
const KNOWN_A = '11111111-1111-4111-8111-111111111111'
const KNOWN_B = '22222222-2222-4222-8222-222222222222'
const HALLUCINATED = '99999999-9999-4999-8999-999999999999'

function fakeThread(messages: Array<{ seq: number; role: 'user' | 'assistant'; content: string }> = []) {
  return {
    thread: {
      id: THREAD_ID,
      dominionId: DOMINION_ID,
      dominionName: 'AEON',
      title: 't',
      status: 'running',
      createdAt: new Date(),
      lastMessageAt: null,
      messageCount: messages.length,
    },
    messages: messages.map((m) => ({
      id: `msg-${m.seq}`,
      threadId: THREAD_ID,
      seq: m.seq,
      role: m.role,
      content: m.content,
      citations: [],
      retrieval: null,
      model: null,
      createdAt: new Date(),
    })),
  }
}

function fakeProvider(replyText: string) {
  // Match getProviderForTask's return shape; cast through unknown to keep
  // the test fixture compact without recreating the full RouteDecision type.
  return {
    decision: {} as unknown,
    provider: {
      ask: vi.fn().mockResolvedValue({ text: replyText, modelId: 'fake-model' }),
    },
  } as unknown as Awaited<ReturnType<typeof import('@/lib/ai/route-task')['getProviderForTask']>>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(safeAuth).mockResolvedValue({ ok: true, userId: USER_ID })
  vi.mocked(retrieveForChat).mockResolvedValue({
    cortex: { id: KNOWN_A, title: 'cortex', body: '', streamClass: 'cortex', createdAt: new Date() },
    archetypes: [{ id: KNOWN_B, title: 'arch', body: '', streamClass: 'archetype', createdAt: new Date() }],
    substrate: [],
  })
  vi.mocked(_appendChatMessage).mockResolvedValue({ ok: true, messageId: 'mid', seq: 2 })
  vi.mocked(_updateChatMessageContent).mockResolvedValue({ ok: true })
})

describe('sendKairosMessage — hallucination guard', () => {
  it('persists only cited ids that were actually retrieved', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([])) // initial load in sendKairosMessage
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }])) // runAssistantTurn's re-fetch

    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider(
      `Here is the answer [[${KNOWN_A}]] plus a fake [[${HALLUCINATED}]] cite`,
    ))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })
    expect(out.ok).toBe(true)

    const assistantAppend = vi.mocked(_appendChatMessage).mock.calls.find(
      (call) => call[2].role === 'assistant',
    )
    expect(assistantAppend).toBeDefined()
    const payload = assistantAppend![2]
    expect(payload.citations).toEqual([KNOWN_A])
    expect(payload.retrieval).toBeDefined()
    expect(payload.retrieval?.cortex?.id).toBe(KNOWN_A)
  })

  it('omits citations when the model cites nothing', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([]))
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }]))
    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider('Plain reply, no citations.'))

    await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })

    const assistantAppend = vi.mocked(_appendChatMessage).mock.calls.find(
      (call) => call[2].role === 'assistant',
    )
    expect(assistantAppend![2].citations).toBeUndefined()
  })

  it('falls back to bare chat when retrieval throws', async () => {
    vi.mocked(retrieveForChat).mockRejectedValueOnce(new Error('FTS down'))
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([]))
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }]))
    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider('still works'))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })
    expect(out.ok).toBe(true)
    const assistantAppend = vi.mocked(_appendChatMessage).mock.calls.find(
      (call) => call[2].role === 'assistant',
    )
    expect(assistantAppend![2].retrieval).toBeUndefined()
    expect(assistantAppend![2].citations).toBeUndefined()
  })
})

describe('sendKairosMessage — persist before AI', () => {
  it('persists the user message before the provider call', async () => {
    const callOrder: string[] = []
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([]))
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }]))
    vi.mocked(_appendChatMessage).mockImplementation(async (_u, _t, p) => {
      callOrder.push(`append:${p.role}`)
      return { ok: true, messageId: 'mid', seq: callOrder.length }
    })
    vi.mocked(getProviderForTask).mockImplementation(async () => {
      callOrder.push('ai')
      return fakeProvider('reply')
    })

    await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })

    expect(callOrder.indexOf('append:user')).toBeLessThan(callOrder.indexOf('ai'))
    expect(callOrder.indexOf('ai')).toBeLessThan(callOrder.indexOf('append:assistant'))
  })

  it('does not append assistant when provider throws', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([]))
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }]))
    vi.mocked(getProviderForTask).mockRejectedValue(new Error('rate limited'))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toBe('ai_failed')

    const assistantAppend = vi.mocked(_appendChatMessage).mock.calls.find(
      (call) => call[2].role === 'assistant',
    )
    expect(assistantAppend).toBeUndefined()
  })

  it('maps AiCredentialMissingError to no_credential', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([]))
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }]))
    vi.mocked(getProviderForTask).mockRejectedValue(new AiCredentialMissingError('anthropic'))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })
    expect(out.ok === false && out.reason).toBe('no_credential')
  })

  it('maps whitespace-only reply to ai_empty', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([]))
      .mockResolvedValueOnce(fakeThread([{ seq: 1, role: 'user', content: 'hello' }]))
    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider('   '))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })
    expect(out.ok === false && out.reason).toBe('ai_empty')
  })
})

describe('sendKairosMessage — orphan-retry recovery', () => {
  it('exact-body retry: skips user-append and reuses the orphan seq', async () => {
    // Trailing user msg with same body as new send → exact-match retry.
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([{ seq: 5, role: 'user', content: 'hello' }]))
      .mockResolvedValueOnce(fakeThread([{ seq: 5, role: 'user', content: 'hello' }]))
    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider('reply'))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'hello' })
    expect(out.ok).toBe(true)
    expect(out.ok && out.userSeq).toBe(5)

    // No user-role append should have happened (only assistant).
    const userAppends = vi.mocked(_appendChatMessage).mock.calls.filter(
      (call) => call[2].role === 'user',
    )
    expect(userAppends).toHaveLength(0)
    expect(vi.mocked(_updateChatMessageContent)).not.toHaveBeenCalled()
  })

  it('edited-body retry: rewrites the orphan body in place, no double-post', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([{ seq: 5, role: 'user', content: 'old draft' }]))
      .mockResolvedValueOnce(fakeThread([{ seq: 5, role: 'user', content: 'new draft' }]))
    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider('reply'))

    const out = await sendKairosMessage({ threadId: THREAD_ID, body: 'new draft' })
    expect(out.ok).toBe(true)
    expect(out.ok && out.userSeq).toBe(5)

    // updateChatMessageContent must have been called with the new body.
    expect(vi.mocked(_updateChatMessageContent)).toHaveBeenCalledWith(USER_ID, THREAD_ID, 5, 'new draft')
    // No new user-role append should have happened.
    const userAppends = vi.mocked(_appendChatMessage).mock.calls.filter(
      (call) => call[2].role === 'user',
    )
    expect(userAppends).toHaveLength(0)
  })

  it('happy path: trailing message is assistant → append new user msg normally', async () => {
    vi.mocked(_getChatThread)
      .mockResolvedValueOnce(fakeThread([
        { seq: 1, role: 'user', content: 'prior' },
        { seq: 2, role: 'assistant', content: 'prior reply' },
      ]))
      .mockResolvedValueOnce(fakeThread([
        { seq: 1, role: 'user', content: 'prior' },
        { seq: 2, role: 'assistant', content: 'prior reply' },
        { seq: 3, role: 'user', content: 'next' },
      ]))
    vi.mocked(getProviderForTask).mockResolvedValue(fakeProvider('next reply'))

    await sendKairosMessage({ threadId: THREAD_ID, body: 'next' })

    const userAppends = vi.mocked(_appendChatMessage).mock.calls.filter(
      (call) => call[2].role === 'user',
    )
    expect(userAppends).toHaveLength(1)
    expect(userAppends[0][2].content).toBe('next')
    expect(vi.mocked(_updateChatMessageContent)).not.toHaveBeenCalled()
  })
})
