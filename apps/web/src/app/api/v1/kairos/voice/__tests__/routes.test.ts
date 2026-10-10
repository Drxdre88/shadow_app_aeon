import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getProviderForTask: vi.fn(),
  findOpenChatThreadByTitle: vi.fn(),
  createChatThread: vi.fn(),
  sendChatMessage: vi.fn(),
  fireChatRoutine: vi.fn(),
  sendWebChatViaRoutine: vi.fn(),
  loadVoiceFeedRows: vi.fn(),
}))

vi.mock('@/lib/api/rateLimit', () => ({ withRateLimit: (handler: unknown) => handler }))
vi.mock('@/lib/api/auth', async () => {
  const { jsonResponse } = await vi.importActual<typeof import('@/lib/api/response')>('@/lib/api/response')
  return {
    authenticateRequest: m.authenticateRequest,
    isApiUser: (result: unknown) => typeof (result as { id?: unknown })?.id === 'string',
    apiHandler: (handler: unknown) => handler,
    jsonError: (message: string, status: number) => jsonResponse({ error: message }, { status }),
  }
})
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: m.getProviderForTask }))
vi.mock('@/lib/data/kairos-chat', () => ({
  findOpenChatThreadByTitle: m.findOpenChatThreadByTitle,
  createChatThread: m.createChatThread,
}))
vi.mock('@/lib/kairos/chat-turn', () => ({ sendChatMessage: m.sendChatMessage }))
vi.mock('@/lib/kairos/moment/chat', () => ({ stripMomentFooters: (s: string) => s }))
vi.mock('@/lib/kairos/chat-routine', () => ({ fireChatRoutine: m.fireChatRoutine }))
vi.mock('@/lib/kairos/chat-web-routine', () => ({ sendWebChatViaRoutine: m.sendWebChatViaRoutine }))
vi.mock('@/lib/kairos/voice/feed-query', () => ({ loadVoiceFeedRows: m.loadVoiceFeedRows }))

import { POST as turnPOST } from '../turn/route'
import { GET as feedGET } from '../feed/route'

type Handler = (r: NextRequest, c: unknown) => Promise<Response>
const turn = (body: unknown) => (turnPOST as Handler)(
  new NextRequest('https://aeon.test/api/v1/kairos/voice/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  {},
)
const feed = (qs = '') => (feedGET as Handler)(new NextRequest(`https://aeon.test/api/v1/kairos/voice/feed${qs}`), {})

function namedError(name: string): Error {
  const err = new Error(name)
  err.name = name
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VORATH_USER_IDS', 'owner-id')
  m.authenticateRequest.mockResolvedValue({ id: 'owner-id', role: 'user' })
  m.findOpenChatThreadByTitle.mockResolvedValue('thread-1')
  m.loadVoiceFeedRows.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('voice routes are owner-only', () => {
  it('answers 404 to a non-owner and touches nothing', async () => {
    m.authenticateRequest.mockResolvedValue({ id: 'beta-user', role: 'user' })
    expect((await turn({ text: 'hello' })).status).toBe(404)
    expect((await feed()).status).toBe(404)
    expect(m.getProviderForTask).not.toHaveBeenCalled()
    expect(m.sendChatMessage).not.toHaveBeenCalled()
    expect(m.loadVoiceFeedRows).not.toHaveBeenCalled()
  })
})

describe('POST voice/turn', () => {
  it('409 when the owner has no paid key, with no routine fallback and nothing saved', async () => {
    m.getProviderForTask.mockRejectedValue(namedError('AiCredentialMissingError'))
    const res = await turn({ text: 'hello' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'no_paid_key' })
    expect(m.sendChatMessage).not.toHaveBeenCalled()
    expect(m.fireChatRoutine).not.toHaveBeenCalled()
    expect(m.sendWebChatViaRoutine).not.toHaveBeenCalled()
    expect(m.createChatThread).not.toHaveBeenCalled()
  })

  it('resolves the owner-initiated voice_chat task, never plain chat', async () => {
    m.getProviderForTask.mockRejectedValue(namedError('AiCredentialDecryptError'))
    const res = await turn({ text: 'hello' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'no_paid_key' })
    expect(m.getProviderForTask).toHaveBeenCalledWith('owner-id', { taskType: 'voice_chat' })
  })

  it('400 on an empty text', async () => {
    expect((await turn({ text: '  ' })).status).toBe(400)
  })

  it('streams the engine turn on the voice channel with the paid provider', async () => {
    m.getProviderForTask.mockResolvedValue({ provider: { providerId: 'byok', modelId: 'tier:heavy', ask: vi.fn(), stream: vi.fn() } })
    m.sendChatMessage.mockResolvedValue({ ok: true, threadId: 'thread-1', userSeq: 3, assistantSeq: 4, assistantContent: '**Yes.** It shipped.', model: 'tier:heavy' })
    const res = await turn({ text: 'did it ship?', threadKey: 'desk' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const body = await res.text()
    expect(body).toContain('event: done')
    expect(body).toContain('"text":"Yes. It shipped."')
    expect(m.findOpenChatThreadByTitle).toHaveBeenCalledWith('owner-id', 'Voice · Vorath · desk')
    const [, threadId, text, opts] = m.sendChatMessage.mock.calls[0]
    expect([threadId, text, opts.channel]).toEqual(['thread-1', 'did it ship?', 'voice'])
    expect(opts.provider).toBeDefined()
    expect(m.fireChatRoutine).not.toHaveBeenCalled()
  })
})

describe('GET voice/feed', () => {
  it('returns items and next, passing the parsed window', async () => {
    const res = await feed('?since=2099-01-01T00:00:00.000Z&limit=5')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], next: expect.any(String) })
    expect(m.loadVoiceFeedRows.mock.calls[0][1].limit).toBe(5)
  })

  it('400 on a bad since', async () => {
    expect((await feed('?since=nope')).status).toBe(400)
  })
})
