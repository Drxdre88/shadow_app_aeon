import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/data/ask', () => ({
  getOpenKairosAskById: vi.fn(),
  markKairosAskAnswered: vi.fn(),
  getPriorAethers: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  captureReflection: vi.fn(),
}))

vi.mock('@/lib/data/dialogue', () => ({
  createDialogue: vi.fn(),
  findOpenDialogueForAsk: vi.fn(),
  loadDialogue: vi.fn(),
  appendDialogueTurn: vi.fn(),
  closeDialogue: vi.fn(),
  fetchMemoriesByIds: vi.fn(),
  fetchAetherPayload: vi.fn(),
  writeFloatingReflection: vi.fn(),
  filterLiveDominionIds: vi.fn(),
}))

vi.mock('../retrieve', () => ({
  retrieveContext: vi.fn(),
  retrieveGlobalContext: vi.fn(),
}))

// One mind: real today.ts / today-render.ts over a mocked data layer.
vi.mock('next/server', () => ({ after: (task: () => Promise<unknown>) => { void task() } }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/kairos-today', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/kairos-today')>()),
  writeTodayEntry: vi.fn(async () => undefined),
  listTodayEntries: vi.fn(async () => []),
}))

import { appendDialogueTurn as appendKairosDialogueTurn } from '../dialogue'
import { listTodayEntries, writeTodayEntry } from '@/lib/data/kairos-today'
import { openKairosDialogue, prepareDialogueContext, commitDialogue } from '../dialogue'
import { getOpenKairosAskById, markKairosAskAnswered, getPriorAethers } from '@/lib/data/ask'
import { captureReflection } from '@/lib/data/memories'
import {
  createDialogue,
  findOpenDialogueForAsk,
  loadDialogue,
  appendDialogueTurn,
  closeDialogue,
  fetchMemoriesByIds,
  fetchAetherPayload,
  writeFloatingReflection,
  filterLiveDominionIds,
} from '@/lib/data/dialogue'
import { retrieveContext, retrieveGlobalContext } from '../retrieve'
import { VORATH_REPLY_STYLE } from '../reply-style'

const USER = 'user-1'
const ASK_ID = 'a0000000-0000-4000-8000-000000000001'
const THREAD = 't0000000-0000-4000-8000-000000000002'
const AETHER_ID = 'e0000000-0000-4000-8000-000000000003'
const THOUGHT_ID = '11111111-1111-4111-8111-111111111111'
const DOM_ID = 'd0000000-0000-4000-8000-000000000004'
const DOM_SWARM = 'd0000000-0000-4000-8000-000000000005'
const DOM_LAB = 'd0000000-0000-4000-8000-000000000006'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function pendingAsk(overrides: Record<string, unknown> = {}) {
  return {
    id: ASK_ID,
    title: 'Is the voice here to stay?',
    summary: null,
    dominionId: null,
    createdAt: new Date('2026-06-13T20:00:00Z'),
    kairosAsk: {
      status: 'pending',
      aetherMemoryId: AETHER_ID,
      sourceThoughtId: THOUGHT_ID,
      sourceMemoryIds: ['m1', 'm2'],
      dominionId: null,
      askedAt: '2026-06-13T20:00:00Z',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openKairosDialogue — ask-seeded', () => {
  it('creates a thread and seeds Kairos\'s opening turn from the pending ask', async () => {
    mock(getOpenKairosAskById).mockResolvedValue(pendingAsk())
    mock(findOpenDialogueForAsk).mockResolvedValue(null)
    mock(createDialogue).mockResolvedValue(THREAD)
    mock(appendDialogueTurn).mockResolvedValue({ ok: true, turnId: 'turn-1', seq: 1 })

    const res = await openKairosDialogue(USER, { questionMemoryId: ASK_ID })

    expect(res).toEqual({ ok: true, threadId: THREAD, created: true, opening: 'Is the voice here to stay?' })
    // seeded with the question as a kairos turn
    expect(appendDialogueTurn).toHaveBeenCalledWith(USER, THREAD, {
      role: 'kairos',
      content: 'Is the voice here to stay?',
    })
    const seed = mock(createDialogue).mock.calls[0][1].seed
    expect(seed).toMatchObject({ kairosAskId: ASK_ID, aetherMemoryId: AETHER_ID, sourceThoughtId: THOUGHT_ID })
  })

  it('is idempotent — returns the existing open dialogue without creating a new one', async () => {
    mock(getOpenKairosAskById).mockResolvedValue(pendingAsk())
    mock(findOpenDialogueForAsk).mockResolvedValue('existing-thread')

    const res = await openKairosDialogue(USER, { questionMemoryId: ASK_ID })

    expect(res).toEqual({ ok: true, threadId: 'existing-thread', created: false, opening: 'Is the voice here to stay?' })
    expect(createDialogue).not.toHaveBeenCalled()
    expect(appendDialogueTurn).not.toHaveBeenCalled()
  })

  it('rejects when the question is not an open ask', async () => {
    mock(getOpenKairosAskById).mockResolvedValue(null)
    const res = await openKairosDialogue(USER, { questionMemoryId: ASK_ID })
    expect(res).toEqual({ ok: false, reason: 'ask_not_found' })
    expect(getOpenKairosAskById).toHaveBeenCalledWith(USER, ASK_ID)
  })

  it('opens a dialogue on any open ask in the backlog, not only the newest', async () => {
    mock(getOpenKairosAskById).mockResolvedValue(pendingAsk({ id: 'older-ask' }))
    mock(findOpenDialogueForAsk).mockResolvedValue(null)
    mock(createDialogue).mockResolvedValue(THREAD)
    mock(appendDialogueTurn).mockResolvedValue({ ok: true, turnId: 'turn-1', seq: 1 })
    const res = await openKairosDialogue(USER, { questionMemoryId: 'older-ask' })
    expect(res).toMatchObject({ ok: true, created: true })
    expect(getOpenKairosAskById).toHaveBeenCalledWith(USER, 'older-ask')
  })
})

describe('openKairosDialogue — free topic', () => {
  it('seeds a floating dialogue from the latest Aether and does not auto-add a turn', async () => {
    mock(getPriorAethers).mockResolvedValue([{ id: AETHER_ID, createdAt: new Date(), payload: null }])
    mock(createDialogue).mockResolvedValue(THREAD)

    const res = await openKairosDialogue(USER, { topic: 'Where should Swarm go next?' })

    expect(res).toEqual({ ok: true, threadId: THREAD, created: true, opening: null })
    expect(appendDialogueTurn).not.toHaveBeenCalled()
    const arg = mock(createDialogue).mock.calls[0][1]
    expect(arg.dominionId).toBeNull()
    expect(arg.seed.kairosAskId).toBeNull()
    expect(arg.seed.aetherMemoryId).toBe(AETHER_ID)
  })

  it('returns no_seed when neither a question nor a topic is given', async () => {
    const res = await openKairosDialogue(USER, {})
    expect(res).toEqual({ ok: false, reason: 'no_seed' })
  })
})

describe('prepareDialogueContext', () => {
  const loaded = {
    thread: {
      id: THREAD,
      userId: USER,
      dominionId: DOM_ID,
      title: 'Is the voice here to stay?',
      status: 'running',
      seed: { kind: 'kairos-dialogue', kairosAskId: ASK_ID, aetherMemoryId: AETHER_ID, sourceThoughtId: THOUGHT_ID, sourceMemoryIds: ['m1'] },
      createdAt: new Date(),
    },
    turns: [
      { id: 'k1', seq: 1, role: 'kairos', content: 'opening question', citations: [], createdAt: new Date() },
      { id: 'o1', seq: 2, role: 'operator', content: 'my latest reply', citations: [], createdAt: new Date() },
    ],
  }

  it('expands the seed thought + grounding and keys retrieval on the last operator turn', async () => {
    mock(loadDialogue).mockResolvedValue(loaded)
    mock(fetchAetherPayload).mockResolvedValue({
      generatedAt: '', coreNarrative: 'the whole empire', shifts: [], tensions: [],
      thoughts: [{ id: THOUGHT_ID, title: 'Owner voice', insight: 'the voice arrived', kind: 'tension', salience: 0.9, dominionId: null, dominionName: null, dominionColor: null, sourceMemoryIds: ['m1'], ageDays: 0 }],
    })
    mock(fetchMemoriesByIds).mockResolvedValue([{ id: 'm1', title: 'src', body: 'b', streamClass: 'reflection', dominionId: null }])
    mock(retrieveContext).mockResolvedValue({ bundle: null, cortex: null, archetypes: [], substrate: [], traces: [] })

    const ctx = await prepareDialogueContext(USER, THREAD)

    expect(ctx).not.toBeNull()
    expect(ctx!.seed.aetherCoreNarrative).toBe('the whole empire')
    expect(ctx!.seed.thought).toEqual({ title: 'Owner voice', insight: 'the voice arrived', kind: 'tension', salience: 0.9 })
    expect(ctx!.seed.sourceMemories).toHaveLength(1)
    expect(ctx!.turns).toHaveLength(2)
    // retrieval query is the latest operator turn
    expect(retrieveContext).toHaveBeenCalledWith({ userId: USER, dominionId: DOM_ID, query: 'my latest reply' })
    expect(ctx!.retrieval).not.toBeNull()
    expect(ctx!.replyStyle).toBe(VORATH_REPLY_STYLE)
  })

  it('searches the whole brain for a floating (Dominion-less) dialogue, e.g. a Triad DM', async () => {
    mock(loadDialogue).mockResolvedValue({ ...loaded, thread: { ...loaded.thread, dominionId: null } })
    mock(fetchAetherPayload).mockResolvedValue(null)
    mock(fetchMemoriesByIds).mockResolvedValue([])
    const hit = { id: 'm9', title: 'EPEX SFTP swap', bodyMd: 'b', streamClass: 'reflection', createdAt: new Date() }
    mock(retrieveGlobalContext).mockResolvedValue({ bundle: null, cortex: null, archetypes: [], substrate: [hit], traces: [] })

    const ctx = await prepareDialogueContext(USER, THREAD)

    expect(retrieveContext).not.toHaveBeenCalled()
    expect(retrieveGlobalContext).toHaveBeenCalledWith({ userId: USER, query: 'my latest reply' })
    expect(ctx!.retrieval!.substrate).toEqual([hit])
  })

  it('returns null when the thread is not found', async () => {
    mock(loadDialogue).mockResolvedValue(null)
    expect(await prepareDialogueContext(USER, THREAD)).toBeNull()
  })
})

describe('commitDialogue', () => {
  const threadWithAsk = {
    thread: {
      id: THREAD, userId: USER, dominionId: null, title: 'x', status: 'running',
      seed: { kind: 'kairos-dialogue', kairosAskId: ASK_ID, aetherMemoryId: AETHER_ID, sourceThoughtId: THOUGHT_ID, sourceMemoryIds: [] },
      createdAt: new Date(),
    },
    turns: [],
  }

  it('writes anchored + floating reflections, marks the ask answered, and closes the thread', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    mock(captureReflection).mockResolvedValue({ ok: true, memory: { id: 'ref-anchored' } })
    mock(writeFloatingReflection).mockResolvedValue('ref-floating')
    mock(getOpenKairosAskById).mockResolvedValue(pendingAsk())
    mock(closeDialogue).mockResolvedValue(true)

    const res = await commitDialogue(USER, THREAD, {
      reflections: [
        { dominionId: DOM_ID, bodyMd: 'anchored insight' },
        { dominionId: null, bodyMd: 'floating insight' },
      ],
    })

    expect(res).toEqual({ ok: true, reflectionIds: ['ref-anchored', 'ref-floating'], closedAsk: true })
    // ask answered against the FIRST reflection
    expect(markKairosAskAnswered).toHaveBeenCalledWith(USER, ASK_ID, 'ref-anchored', expect.any(String))
    expect(closeDialogue).toHaveBeenCalledWith(USER, THREAD)
    // kairos-dialogue tag always added
    expect(mock(captureReflection).mock.calls[0][1].tags).toContain('kairos-dialogue')
  })

  it('auto-tags a floating reflection with dominion:<id> refs for the fronts it touches', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    mock(writeFloatingReflection).mockResolvedValue('ref-1')
    mock(getOpenKairosAskById).mockResolvedValue(pendingAsk())
    mock(closeDialogue).mockResolvedValue(true)
    // both requested fronts are live + owned
    mock(filterLiveDominionIds).mockResolvedValue([DOM_SWARM, DOM_LAB])

    await commitDialogue(USER, THREAD, {
      reflections: [{ dominionId: null, dominionIds: [DOM_SWARM, DOM_LAB], bodyMd: 'spans two fronts' }],
    })

    expect(filterLiveDominionIds).toHaveBeenCalledWith(USER, [DOM_SWARM, DOM_LAB])
    const tags = mock(writeFloatingReflection).mock.calls[0][1].tags
    expect(tags).toEqual(['kairos-dialogue', `dominion:${DOM_SWARM}`, `dominion:${DOM_LAB}`])
  })

  it('drops the home dominionId and any foreign ids from the reference tags', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    mock(captureReflection).mockResolvedValue({ ok: true, memory: { id: 'ref-anchored' } })
    mock(getOpenKairosAskById).mockResolvedValue(pendingAsk())
    mock(closeDialogue).mockResolvedValue(true)
    // DOM_SWARM survives validation; the foreign id is dropped by the data layer
    mock(filterLiveDominionIds).mockResolvedValue([DOM_SWARM])

    await commitDialogue(USER, THREAD, {
      reflections: [{ dominionId: DOM_ID, dominionIds: [DOM_ID, DOM_SWARM, 'foreign'], bodyMd: 'has a home' }],
    })

    // home (DOM_ID) is excluded BEFORE validation — the FK already covers it
    expect(filterLiveDominionIds).toHaveBeenCalledWith(USER, [DOM_SWARM, 'foreign'])
    const tags = mock(captureReflection).mock.calls[0][1].tags
    expect(tags).toEqual(['kairos-dialogue', `dominion:${DOM_SWARM}`])
  })

  it('does not validate dominions when no dominionIds are supplied', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    mock(writeFloatingReflection).mockResolvedValue('ref-1')
    mock(closeDialogue).mockResolvedValue(true)

    await commitDialogue(USER, THREAD, { reflections: [{ bodyMd: 'plain' }], closeAsk: false })

    expect(filterLiveDominionIds).not.toHaveBeenCalled()
    expect(mock(writeFloatingReflection).mock.calls[0][1].tags).toEqual(['kairos-dialogue'])
  })

  it('does not close the ask when closeAsk is false', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    mock(writeFloatingReflection).mockResolvedValue('ref-1')
    mock(closeDialogue).mockResolvedValue(true)

    const res = await commitDialogue(USER, THREAD, { reflections: [{ bodyMd: 'x' }], closeAsk: false })

    expect(res).toMatchObject({ ok: true, closedAsk: false })
    expect(markKairosAskAnswered).not.toHaveBeenCalled()
    expect(closeDialogue).toHaveBeenCalled()
  })

  it('surfaces dominion_not_found and does not close the thread', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    mock(captureReflection).mockResolvedValue({ ok: false, reason: 'dominion_not_found' })

    const res = await commitDialogue(USER, THREAD, { reflections: [{ dominionId: 'bad', bodyMd: 'x' }] })

    expect(res).toEqual({ ok: false, reason: 'dominion_not_found' })
    expect(closeDialogue).not.toHaveBeenCalled()
  })

  it('rejects an empty distillation', async () => {
    mock(loadDialogue).mockResolvedValue(threadWithAsk)
    const res = await commitDialogue(USER, THREAD, { reflections: [] })
    expect(res).toEqual({ ok: false, reason: 'no_reflections' })
  })

  it('returns thread_not_found when the thread is missing', async () => {
    mock(loadDialogue).mockResolvedValue(null)
    const res = await commitDialogue(USER, THREAD, { reflections: [{ bodyMd: 'x' }] })
    expect(res).toEqual({ ok: false, reason: 'thread_not_found' })
  })
})

describe('dialogue ↔ today (one mind)', () => {
  it('an operator turn is logged as a relayed agent statement, never the owner', async () => {
    mock(appendDialogueTurn).mockResolvedValue({ ok: true, turnId: 'turn-3', seq: 3 })

    const res = await appendKairosDialogueTurn(USER, THREAD, 'operator', 'I said ship it')

    expect(res).toEqual({ ok: true, seq: 3, turnId: 'turn-3' })
    await vi.waitFor(() => expect(writeTodayEntry).toHaveBeenCalledTimes(1))
    const [, payload, mode] = mock(writeTodayEntry).mock.calls[0]
    expect(mode).toBe('upsert')
    expect(payload).toMatchObject({
      key: `dialogue:${THREAD}:3`,
      channel: 'triad',
      type: 'said',
      speaker: 'agent',
      relayedRole: 'operator',
      origin: { kind: 'agent', via: 'dialogue' },
      ref: { dialogueId: THREAD, seq: 3 },
      covered: 'dialogue-commit',
      text: 'I said ship it',
    })
  })

  it('a kairos turn is logged as replied, not relayed', async () => {
    mock(appendDialogueTurn).mockResolvedValue({ ok: true, turnId: 'turn-4', seq: 4 })

    await appendKairosDialogueTurn(USER, THREAD, 'kairos', 'Then ship it Friday.')

    await vi.waitFor(() => expect(writeTodayEntry).toHaveBeenCalledTimes(1))
    const payload = mock(writeTodayEntry).mock.calls[0][1]
    expect(payload).toMatchObject({ type: 'replied', speaker: 'agent', channel: 'triad' })
    expect(payload).not.toHaveProperty('relayedRole')
  })

  it('records nothing when the thread is missing', async () => {
    mock(appendDialogueTurn).mockResolvedValue({ ok: false, reason: 'thread_not_found' })
    await appendKairosDialogueTurn(USER, THREAD, 'operator', 'x')
    expect(writeTodayEntry).not.toHaveBeenCalled()
  })

  it('prepare carries a seeded Telegram owner statement, excluding this dialogue', async () => {
    mock(loadDialogue).mockResolvedValue({
      thread: {
        id: THREAD, userId: USER, dominionId: null, title: 'Topic', status: 'running', createdAt: new Date(),
        seed: { kind: 'kairos-dialogue', kairosAskId: null, aetherMemoryId: null, sourceThoughtId: null, sourceMemoryIds: [] },
      },
      turns: [],
    })
    mock(fetchMemoriesByIds).mockResolvedValue([])
    mock(listTodayEntries).mockResolvedValue([{
      createdAt: new Date('2026-10-03T10:00:00Z'),
      toolName: 'telegram',
      payload: {
        v: 1, key: 'chat:tg:7', channel: 'telegram', type: 'said', origin: { kind: 'operator', via: 'telegram' },
        speaker: 'owner', text: 'Hydra export before Friday', covered: 'chat-distill',
      },
    }])

    const ctx = await prepareDialogueContext(USER, THREAD)

    expect(listTodayEntries).toHaveBeenCalledWith(USER, expect.objectContaining({ excludeThreadId: THREAD }))
    expect(ctx!.today).toContain('## Today across channels')
    expect(ctx!.today).toContain('owner·telegram said: "Hydra export before Friday"')
    expect(ctx!.today).toContain('BEGIN TODAY DATA')
  })

  it('prepare returns an empty today string on a quiet day', async () => {
    mock(loadDialogue).mockResolvedValue({
      thread: {
        id: THREAD, userId: USER, dominionId: null, title: 'Topic', status: 'running', createdAt: new Date(),
        seed: { kind: 'kairos-dialogue', kairosAskId: null, aetherMemoryId: null, sourceThoughtId: null, sourceMemoryIds: [] },
      },
      turns: [],
    })
    mock(fetchMemoriesByIds).mockResolvedValue([])
    mock(listTodayEntries).mockResolvedValue([])
    expect((await prepareDialogueContext(USER, THREAD))!.today).toBe('')
  })
})
