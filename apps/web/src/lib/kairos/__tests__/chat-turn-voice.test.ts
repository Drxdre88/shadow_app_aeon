import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/memories', () => ({ searchMemoriesFts: vi.fn(), listRecentMemories: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findProjects: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({ getKairosAskSourceSnippets: vi.fn(async () => []), getPendingKairosAsk: vi.fn() }))
vi.mock('@/lib/data/kairos-chat', () => ({ appendChatMessage: vi.fn(), getChatThread: vi.fn(), updateChatMessageContent: vi.fn() }))
vi.mock('@/lib/kairos/ask', () => ({ answerKairosAsk: vi.fn() }))
vi.mock('@/lib/kairos/reactions', () => ({ reactUsed: vi.fn(async () => undefined) }))
vi.mock('@/lib/kairos/chat-retrieval', () => ({
  extractCitationIds: vi.fn(() => []),
  intersectWithRetrieved: vi.fn(() => []),
  retrieveForChatGlobal: vi.fn(),
}))
vi.mock('@/lib/kairos/chat-grounding', () => ({
  loadBoardSection: vi.fn(async () => undefined),
  loadRecencySection: vi.fn(async () => undefined),
}))
vi.mock('@/lib/kairos/conscience-context', () => ({ loadConscienceBlock: vi.fn(async () => '') }))
vi.mock('@/lib/kairos/chat-today', () => ({
  chatTodayChannel: (_s: unknown, c?: string) => (c === 'voice' ? 'voice' : 'web'),
  loadChatTodaySection: vi.fn(async () => ''),
  recordChatOwnerTurn: vi.fn(),
  recordChatReply: vi.fn(async () => undefined),
}))
vi.mock('@/lib/kairos/moment/chat', () => ({
  loadMomentChatOptions: vi.fn(async () => ({ momentSections: ['OWNER MODEL BLOCK'] })),
  finishChatReply: vi.fn(async (_u: string, _t: string, raw: string) => raw),
  stripMomentFooters: (s: string) => s,
}))
const detached = vi.hoisted(() => ({ tasks: [] as Promise<void>[] }))
vi.mock('@/lib/kairos/moment/detached', () => ({
  runDetached: vi.fn((task: () => Promise<void>) => { detached.tasks.push(task()) }),
}))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
}))

import { getPendingKairosAsk } from '@/lib/data/ask'
import { appendChatMessage, getChatThread } from '@/lib/data/kairos-chat'
import type { AIProvider, AIRequest } from '@/lib/ai/provider'
import { answerKairosAsk } from '@/lib/kairos/ask'
import { reactUsed } from '@/lib/kairos/reactions'
import { intersectWithRetrieved, retrieveForChatGlobal, type ChatRetrieval } from '@/lib/kairos/chat-retrieval'
import { loadChatTodaySection } from '@/lib/kairos/chat-today'
import { loadMomentChatOptions } from '@/lib/kairos/moment/chat'
import { runAssistantTurn, sendChatMessage, type ChatTurnMark } from '../chat-turn'
import { VOICE_GROUNDING, VOICE_RETRIEVAL } from '../voice/grounding'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CITED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const memory = (id: string, chars = 1500) => ({ id, title: `T ${id}`, body: 'x'.repeat(chars), streamClass: 'reflection' as const, createdAt: new Date() })
const fullRetrieval: ChatRetrieval = {
  cortex: memory('aether'),
  archetypes: Array.from({ length: 10 }, (_, i) => memory(`arch-${i}`)),
  substrate: Array.from({ length: 5 }, (_, i) => memory(`sub-${i}`)),
}

const pendingAsk = {
  id: 'ask-1',
  title: 'Revive mobile this month?',
  summary: null,
  dominionId: null,
  createdAt: new Date(),
  kairosAsk: { status: 'pending' as const, aetherMemoryId: '', sourceThoughtId: null, sourceMemoryIds: [], dominionId: null, askedAt: '' },
  askMine: null,
}

function fakeProvider(answers: string[]): AIProvider & { ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async (_req: AIRequest) => ({ text: answers.shift() ?? '', providerId: 'p', modelId: 'm' }))
  return { providerId: 'p', modelId: 'm', ask, stream: async function* () {} }
}

const history = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, role: i % 2 ? 'assistant' : 'user', content: `turn ${i + 1}`, createdAt: new Date() }))

beforeEach(() => {
  vi.clearAllMocks()
  detached.tasks.length = 0
  vi.mocked(getChatThread).mockResolvedValue({ thread: { id: THREAD_ID, dominionId: null }, messages: history } as never)
  vi.mocked(appendChatMessage).mockResolvedValue({ ok: true, messageId: 'm-2', seq: 22 })
  vi.mocked(retrieveForChatGlobal).mockResolvedValue(fullRetrieval)
  vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
})

function systemPrompt(provider: { ask: ReturnType<typeof vi.fn> }): string {
  return (provider.ask.mock.calls[0][0] as AIRequest).messages![0].content
}

describe('voice turns: the voice-sized grounding bundle', () => {
  it('sends fewer, shorter sources and no moment blocks than web chat for the same brain', async () => {
    const web = fakeProvider(['Web answer.'])
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'how are you?', 21, { provider: web, tools: false })
    const voice = fakeProvider(['Voice answer.'])
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'how are you?', 21, { provider: voice, tools: false, channel: 'voice' })

    const webPrompt = systemPrompt(web)
    const voicePrompt = systemPrompt(voice)
    expect(voicePrompt.length).toBeLessThan(webPrompt.length / 3)
    expect(webPrompt).toContain('arch-9')
    expect(voicePrompt).toContain(`arch-${VOICE_GROUNDING.archetypes - 1}`)
    expect(voicePrompt).not.toContain(`arch-${VOICE_GROUNDING.archetypes}`)
    expect(voicePrompt).not.toContain(`sub-${VOICE_GROUNDING.substrate}`)
    expect(webPrompt).toContain('OWNER MODEL BLOCK')
    expect(voicePrompt).not.toContain('OWNER MODEL BLOCK')
    expect(loadMomentChatOptions).toHaveBeenCalledTimes(1)
    expect(vi.mocked(loadChatTodaySection).mock.calls[1]).toEqual([USER_ID, THREAD_ID, VOICE_GROUNDING.todayChars])
    const voiceMessages = (voice.ask.mock.calls[0][0] as AIRequest).messages!
    expect(voiceMessages).toHaveLength(1 + VOICE_GROUNDING.historyMessages + 1)
    expect(voiceMessages.at(-2)!.content).toBe('turn 20')
  })

  it('starts every grounding read at once instead of one after another', async () => {
    let releaseThread: (v: unknown) => void = () => {}
    vi.mocked(getChatThread).mockReturnValueOnce(new Promise((resolve) => { releaseThread = resolve }) as never)
    const turn = runAssistantTurn(USER_ID, THREAD_ID, null, 'hi', 21, { provider: fakeProvider(['Hi.']), tools: false, channel: 'voice' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(retrieveForChatGlobal).toHaveBeenCalledTimes(1)
    expect(getPendingKairosAsk).toHaveBeenCalledTimes(1)
    expect(loadChatTodaySection).toHaveBeenCalledTimes(1)
    releaseThread({ thread: { id: THREAD_ID, dominionId: null }, messages: history })
    expect((await turn).ok).toBe(true)
  })

  it('cites only what the voice prompt showed', async () => {
    vi.mocked(intersectWithRetrieved).mockReturnValueOnce([])
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'hi', 21, { provider: fakeProvider(['Hi.']), tools: false, channel: 'voice' })
    const retrieved = vi.mocked(intersectWithRetrieved).mock.calls[0][1]
    expect(retrieved.archetypes).toHaveLength(VOICE_GROUNDING.archetypes)
    expect(retrieved.substrate).toHaveLength(VOICE_GROUNDING.substrate)
  })
})

describe('voice turns: tools only when needed', () => {
  it('tools:false answers in one tool-less call', async () => {
    const provider = fakeProvider(['Fine.'])
    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'how are you?', 21, { provider, tools: false, channel: 'voice' })
    expect(result.ok).toBe(true)
    expect(provider.ask).toHaveBeenCalledTimes(1)
    expect(provider.ask.mock.calls[0][0]).not.toHaveProperty('tools')
  })

  it('tools left on still runs the tool loop', async () => {
    const provider = fakeProvider(['Checked.'])
    await runAssistantTurn(USER_ID, THREAD_ID, null, "what's the latest on swarm?", 21, { provider, channel: 'voice' })
    expect((provider.ask.mock.calls[0][0] as AIRequest).tools).toBeDefined()
  })
})

describe('voice turns: deferred side work', () => {
  it('classifies the pending ask after the reply is saved, on the side provider, and still applies it', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(pendingAsk as never)
    vi.mocked(answerKairosAsk).mockResolvedValue({ reflectionId: 'r-1' } as never)
    const provider = fakeProvider(['Only after the beta.'])
    const side = fakeProvider([JSON.stringify({ answersPending: true })])
    const marks: ChatTurnMark[] = []

    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'Only after the web beta.', 21, {
      provider, sideProvider: side, tools: false, channel: 'voice', onMark: (m) => marks.push(m),
    })

    expect(result.ok).toBe(true)
    expect(provider.ask).toHaveBeenCalledTimes(1)
    expect(vi.mocked(appendChatMessage).mock.invocationCallOrder[0]).toBeLessThan(side.ask.mock.invocationCallOrder[0])
    await Promise.all(detached.tasks)
    expect(side.ask).toHaveBeenCalledTimes(1)
    expect(answerKairosAsk).toHaveBeenCalledTimes(1)
    expect(marks).toEqual(['retrieved', 'grounded', 'answered', 'saved'])
  })

  it('reinforces cited memories detached, after the append', async () => {
    vi.mocked(intersectWithRetrieved).mockReturnValueOnce([CITED])
    const result = await runAssistantTurn(USER_ID, THREAD_ID, null, 'hi', 21, { provider: fakeProvider([`Yes [[${CITED}]].`]), tools: false, channel: 'voice' })
    expect(result.ok).toBe(true)
    expect(detached.tasks).toHaveLength(1)
    await Promise.all(detached.tasks)
    expect(reactUsed).toHaveBeenCalledWith(USER_ID, [CITED], expect.any(String))
    expect(vi.mocked(appendChatMessage).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(reactUsed).mock.invocationCallOrder[0])
  })

  it('web chat keeps classifying before it saves', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(pendingAsk as never)
    const provider = fakeProvider(['Noted.', JSON.stringify({ answersPending: false })])
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'no', 21, { provider, tools: false })
    expect(provider.ask).toHaveBeenCalledTimes(2)
    expect(provider.ask.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(appendChatMessage).mock.invocationCallOrder[0])
    expect(detached.tasks).toHaveLength(0)
  })
})

describe('voice turns: the owner turn saves while the context is built', () => {
  const loaded = () => ({ thread: { id: THREAD_ID, dominionId: null }, messages: history }) as never

  it('asks retrieval for the light voice path: fused order, no rerank, no expansion, no traces', async () => {
    const spans: string[] = []
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'hi', 21, {
      provider: fakeProvider(['Hi.']), tools: false, channel: 'voice', onSpan: (name) => spans.push(name),
    })
    const [, , options] = vi.mocked(retrieveForChatGlobal).mock.calls[0]
    expect(options).toMatchObject({ ...VOICE_RETRIEVAL, onTiming: expect.any(Function) })
    expect(options).toMatchObject({ rerank: false, expand: false, entity: false, traces: false })
    expect(spans).toEqual(expect.arrayContaining(['retrieval', 'section:history', 'section:pendingAsk', 'section:today', 'section:conscience']))
  })

  it('web chat keeps the full retrieval', async () => {
    await runAssistantTurn(USER_ID, THREAD_ID, null, 'hi', 21, { provider: fakeProvider(['Hi.']), tools: false })
    expect(vi.mocked(retrieveForChatGlobal).mock.calls[0]).toHaveLength(2)
  })

  it('reuses the route-read thread, starts retrieval before the save lands, and calls the model only after it', async () => {
    let saved: (v: unknown) => void = () => {}
    vi.mocked(appendChatMessage).mockReturnValueOnce(new Promise((resolve) => { saved = resolve }) as never)
    const provider = fakeProvider(['Hi.'])
    const spans: string[] = []
    const turn = sendChatMessage(USER_ID, THREAD_ID, 'hi there', {
      provider, tools: false, channel: 'voice', loadedThread: loaded(), onSpan: (name) => spans.push(name),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(retrieveForChatGlobal).toHaveBeenCalledTimes(1)
    expect(provider.ask).not.toHaveBeenCalled()
    saved({ ok: true, messageId: 'm-21', seq: 21 })
    const result = await turn

    expect(result).toMatchObject({ ok: true, userSeq: 21 })
    expect(getChatThread).not.toHaveBeenCalled()
    expect(spans).toContain('thread')
    const messages = (provider.ask.mock.calls[0][0] as AIRequest).messages!
    expect(messages.filter((m) => m.content === 'hi there')).toHaveLength(1)
    expect(messages.at(-2)!.content).toBe('turn 20')
    expect(vi.mocked(appendChatMessage).mock.calls[1][2]).toMatchObject({ role: 'assistant', content: 'Hi.' })
  })

  it('a failed save never reaches the model', async () => {
    vi.mocked(appendChatMessage).mockResolvedValueOnce({ ok: false, reason: 'thread_not_found' })
    const provider = fakeProvider(['Hi.'])
    const result = await sendChatMessage(USER_ID, THREAD_ID, 'hi', { provider, tools: false, channel: 'voice', loadedThread: loaded() })
    expect(result).toEqual({ ok: false, reason: 'thread_not_found' })
    expect(provider.ask).not.toHaveBeenCalled()
  })
})