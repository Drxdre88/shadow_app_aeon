import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/aether', () => ({ getLatestAether: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({
  getPriorAethers: vi.fn(),
  getReflectionsSince: vi.fn(),
  getPendingKairosAsk: vi.fn(),
  getNewestKairosAsk: vi.fn(),
  createKairosAskMemory: vi.fn(),
  markKairosAskAnswered: vi.fn(),
  archiveOrphanAnswerMemory: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({
  captureReflection: vi.fn(),
  markKairosSpeaksReplied: vi.fn(),
}))
vi.mock('@/lib/data/tasks', () => ({
  findTaskById: vi.fn(),
  appendTaskDescription: vi.fn(),
}))
vi.mock('@/lib/data/projects', () => ({
  verifyProjectAccess: vi.fn(),
}))
vi.mock('@/lib/data/vault', () => ({
  updateVaultDescription: vi.fn(),
}))

import { getPendingKairosAsk, markKairosAskAnswered, type KairosAskRow } from '@/lib/data/ask'
import { captureReflection, markKairosSpeaksReplied } from '@/lib/data/memories'
import { appendTaskDescription, findTaskById } from '@/lib/data/tasks'
import { verifyProjectAccess } from '@/lib/data/projects'
import { updateVaultDescription } from '@/lib/data/vault'
import { answerKairosAsk, appendCardNote, parseCardNotesAnswer, writeBackCardNotes } from '../ask'
import { selectKairosQuestion, type SelectInput } from '../ask-select'
import type { AetherPayload } from '../aether-types'

// ─── fixture helpers ────────────────────────────────────────────────────

const MEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEM_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEM_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const THOUGHT_ID_Q  = '11111111-1111-4111-8111-111111111111'
const THOUGHT_ID_T  = '22222222-2222-4222-8222-222222222222'
const THOUGHT_ID_Q2 = '33333333-3333-4333-8333-333333333333'

const DOM_ID = '99999999-9999-4999-8999-999999999999'

function makePayload(overrides: Partial<AetherPayload> = {}): AetherPayload {
  return {
    generatedAt: '2026-06-12T00:00:00Z',
    coreNarrative: 'A test narrative.',
    thoughts: [],
    tensions: [],
    shifts: [],
    ...overrides,
  }
}

function baseInput(overrides: Partial<SelectInput> = {}): SelectInput {
  return {
    latest: makePayload(),
    priorThoughtSourceIds: [],
    addressedSourceIds: new Set(),
    lastAskedAt: null,
    now: new Date('2026-06-12T10:00:00Z'),
    ...overrides,
  }
}

// ─── selectKairosQuestion ────────────────────────────────────────────────

describe('selectKairosQuestion', () => {
  it('returns null when there are no qualifying thoughts', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Conclusion text',
              insight: 'Some insight.',
              kind: 'conclusion',
              salience: 0.95,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'blue',
              ageDays: 0,
            },
          ],
        }),
      }),
    )
    expect(result).toBeNull()
  })

  it('returns null when all qualifying thoughts are below the bar', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'What should we do next?',
              insight: 'We are at a crossroads.',
              kind: 'question',
              salience: 0.5,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'blue',
              ageDays: 0,
            },
          ],
        }),
      }),
    )
    expect(result).toBeNull()
  })

  it('returns null (silence) when within the cadence window regardless of candidate quality', () => {
    const lastAskedAt = new Date('2026-06-12T04:00:00Z')
    const now = new Date('2026-06-12T10:00:00Z')

    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Is the strategy still valid?',
              insight: 'Worth revisiting.',
              kind: 'question',
              salience: 0.99,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'cyan',
              ageDays: 0,
            },
          ],
        }),
        lastAskedAt,
        now,
      }),
    )
    expect(result).toBeNull()
  })

  it('picks the highest-salience question-kind thought above the bar', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'What is the main bottleneck?',
              insight: 'Performance is degrading.',
              kind: 'question',
              salience: 0.85,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'purple',
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_Q2,
              title: 'Should we pivot?',
              insight: 'Direction is unclear.',
              kind: 'question',
              salience: 0.80,
              sourceMemoryIds: [MEM_B],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'purple',
              ageDays: 0,
            },
          ],
        }),
      }),
    )
    expect(result).not.toBeNull()
    expect(result!.sourceThoughtId).toBe(THOUGHT_ID_Q)
    expect(result!.score).toBeCloseTo(0.85)
    expect(result!.question).toContain('?')
  })

  it('persistence boost beats a higher-base one-off candidate when scores are close', () => {
    const priorSourceIds = [[MEM_C, MEM_D]]

    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'One-off high-salience question?',
              insight: 'A fresh insight.',
              kind: 'question',
              salience: 0.85,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'green',
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_T,
              title: 'Recurring concern?',
              insight: 'This keeps coming up.',
              kind: 'tension',
              salience: 0.79,
              sourceMemoryIds: [MEM_C, MEM_D],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'green',
              ageDays: 2,
            },
          ],
        }),
        priorThoughtSourceIds: priorSourceIds,
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.sourceThoughtId).toBe(THOUGHT_ID_T)
    expect(result!.score).toBeCloseTo(0.79 + 0.15)
  })

  it('drops a candidate whose sourceMemoryIds are all in addressedSourceIds', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Already addressed question?',
              insight: 'We have an answer.',
              kind: 'question',
              salience: 0.95,
              sourceMemoryIds: [MEM_A, MEM_B],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'red',
              ageDays: 0,
            },
          ],
        }),
        addressedSourceIds: new Set([MEM_A, MEM_B]),
      }),
    )
    expect(result).toBeNull()
  })

  it('synthesises a candidate from tensions[] and returns it when above the bar', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Signal A',
              insight: 'First signal.',
              kind: 'conclusion',
              salience: 0.7,
              sourceMemoryIds: [MEM_A],
              dominionId: DOM_ID,
              dominionName: 'Test',
              dominionColor: 'teal',
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_T,
              title: 'Signal B',
              insight: 'Second signal.',
              kind: 'conclusion',
              salience: 0.7,
              sourceMemoryIds: [MEM_B],
              dominionId: null,
              dominionName: null,
              dominionColor: null,
              ageDays: 0,
            },
          ],
          tensions: [
            { aId: THOUGHT_ID_Q, bId: THOUGHT_ID_T, note: 'Are these two signals contradicting each other?' },
          ],
        }),
        // a lone tension scores 0.75, below the default 0.78 bar by design;
        // lower the bar here to exercise the synthesis mechanics
        opts: { bar: 0.7 },
      }),
    )

    expect(result).not.toBeNull()
    expect(result!.dominionId).toBeNull()
    expect(result!.sourceThoughtId).toBeNull()
    expect(result!.question).toContain('?')
    expect(result!.sourceMemoryIds).toEqual(expect.arrayContaining([MEM_A, MEM_B]))
    expect(result!.score).toBeCloseTo(0.75)
  })

  it('deduplicates sourceMemoryIds when both tension thoughts share a memory', () => {
    const result = selectKairosQuestion(
      baseInput({
        latest: makePayload({
          thoughts: [
            {
              id: THOUGHT_ID_Q,
              title: 'Alpha',
              insight: 'Alpha insight.',
              kind: 'conclusion',
              salience: 0.6,
              sourceMemoryIds: [MEM_A, MEM_B],
              dominionId: null,
              dominionName: null,
              dominionColor: null,
              ageDays: 0,
            },
            {
              id: THOUGHT_ID_T,
              title: 'Beta',
              insight: 'Beta insight.',
              kind: 'conclusion',
              salience: 0.6,
              sourceMemoryIds: [MEM_B, MEM_C],
              dominionId: null,
              dominionName: null,
              dominionColor: null,
              ageDays: 0,
            },
          ],
          tensions: [{ aId: THOUGHT_ID_Q, bId: THOUGHT_ID_T, note: 'Alpha and Beta diverge' }],
        }),
        opts: { bar: 0.7 },
      }),
    )

    expect(result).not.toBeNull()
    const ids = result!.sourceMemoryIds
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
    expect(unique.has(MEM_B)).toBe(true)
  })
})

// ─── answerKairosAsk — reply gate ───────────────────────────────────────

describe('answerKairosAsk clears the Kairos reply gate', () => {
  const USER = 'user-1'
  const ASK_ID = 'ask-1'
  const pendingAsk: KairosAskRow = {
    id: ASK_ID,
    title: 'What should change?',
    summary: 'What should change?',
    dominionId: DOM_ID,
    createdAt: new Date('2026-07-13T08:00:00Z'),
    kairosAsk: {
      status: 'pending',
      aetherMemoryId: 'aether-1',
      sourceThoughtId: null,
      sourceMemoryIds: [],
      dominionId: DOM_ID,
      askedAt: '2026-07-13T08:00:00.000Z',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPendingKairosAsk).mockResolvedValue(pendingAsk)
    vi.mocked(captureReflection).mockResolvedValue({ ok: true, memory: { id: 'reflection-1' } } as never)
    vi.mocked(markKairosAskAnswered).mockResolvedValue(true as never)
    vi.mocked(markKairosSpeaksReplied).mockResolvedValue(1)
  })

  it('marks pending speaks replied after a successful answer', async () => {
    await expect(answerKairosAsk(USER, ASK_ID, 'An answer')).resolves.toEqual({ reflectionId: 'reflection-1' })
    expect(markKairosSpeaksReplied).toHaveBeenCalledWith(USER, expect.any(Date))
  })

  it('never fails the answer when the marker throws', async () => {
    vi.mocked(markKairosSpeaksReplied).mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(answerKairosAsk(USER, ASK_ID, 'An answer')).resolves.toEqual({ reflectionId: 'reflection-1' })
    errorSpy.mockRestore()
  })

  it('does not mark when the ask is stale', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)

    await expect(answerKairosAsk(USER, ASK_ID, 'An answer')).resolves.toEqual({ error: 'not_found' })
    expect(markKairosSpeaksReplied).not.toHaveBeenCalled()
  })
})

// ─── card_notes answers → write-back ────────────────────────────────────

describe('card_notes answers', () => {
  const USER = 'user-1'
  const ASK_ID = 'ask-cards'
  const CARDS = [
    { taskId: 'task-a', projectId: 'proj-1', title: 'Deploy' },
    { vaultId: 'vault-b', projectId: 'proj-1', title: 'Fix login' },
    { taskId: 'task-c', projectId: 'proj-1', title: 'Tidy inbox' },
  ]

  function cardAsk(cards = CARDS): KairosAskRow {
    return {
      id: ASK_ID,
      title: 'cards?',
      summary: null,
      dominionId: DOM_ID,
      createdAt: new Date('2026-09-30T04:30:00Z'),
      kairosAsk: {
        status: 'pending',
        aetherMemoryId: '',
        sourceThoughtId: null,
        sourceMemoryIds: [],
        dominionId: DOM_ID,
        askedAt: '2026-09-30T04:30:00.000Z',
      },
      askMine: { date: '2026-09-30', kind: 'card_notes', sourceMemoryIds: [], leverage: 0.5 },
      cardNotes: { date: '2026-09-29', boardDayMemoryIds: ['page-1'], cards },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T09:00:00Z'))
    vi.mocked(getPendingKairosAsk).mockResolvedValue(cardAsk())
    vi.mocked(captureReflection).mockResolvedValue({ ok: true, memory: { id: 'reflection-1' } } as never)
    vi.mocked(markKairosAskAnswered).mockResolvedValue(true as never)
    vi.mocked(markKairosSpeaksReplied).mockResolvedValue(1)
    vi.mocked(verifyProjectAccess).mockResolvedValue({ project: {}, role: 'owner' } as never)
    vi.mocked(findTaskById).mockImplementation(async (taskId) => ({ id: taskId, description: taskId === 'task-c' ? 'Existing notes' : null }) as never)
    vi.mocked(appendTaskDescription).mockResolvedValue({} as never)
    vi.mocked(updateVaultDescription).mockImplementation(async (_vaultId, _projectId, compose) => {
      return compose('Vaulted notes') === null ? 'rejected' : 'written'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('parses numbered lines in any of the common shapes, with continuations', () => {
    const notes = parseCardNotesAnswer('3) cleared the backlog\n1. prod deploy for the feed\n  after the hotfix\n2 - token refresh bug', CARDS)
    expect(notes.map((n) => [n.card.title, n.line])).toEqual([
      ['Deploy', 'prod deploy for the feed after the hotfix'],
      ['Fix login', 'token refresh bug'],
      ['Tidy inbox', 'cleared the backlog'],
    ])
  })

  it('maps plain bullets in order only when their count matches', () => {
    expect(parseCardNotesAnswer('- a\n- b\n- c', CARDS).map((n) => n.line)).toEqual(['a', 'b', 'c'])
    expect(parseCardNotesAnswer('- a\n- b', CARDS)).toEqual([])
  })

  it('gives the whole answer to a single card', () => {
    const notes = parseCardNotesAnswer('It was the\nprod deploy.', [CARDS[0]!])
    expect(notes).toEqual([{ card: CARDS[0], line: 'It was the prod deploy.' }])
  })

  it('clips a long single-card answer so a whole chat turn never lands on the card', () => {
    const [note] = parseCardNotesAnswer('x '.repeat(600), [CARDS[0]!])
    expect(note!.line.length).toBeLessThanOrEqual(500)
    expect(note!.line.endsWith('…')).toBe(true)
  })

  it('appends a dated Kairos note to the description', () => {
    const at = new Date('2026-09-30T09:00:00Z')
    expect(appendCardNote(null, 'x', at)).toBe('Notes (via Kairos, 30/09): x')
    expect(appendCardNote('Old\n', 'x', at)).toBe('Old\n\nNotes (via Kairos, 30/09): x')
  })

  it('writes three numbered lines back: live cards via atomic append, vaulted card via the vault', async () => {
    const result = await answerKairosAsk(USER, ASK_ID, '1. prod deploy\n2. token bug\n3. inbox zero')

    expect(result).toEqual({ reflectionId: 'reflection-1' })
    expect(captureReflection).toHaveBeenCalledWith(USER, expect.objectContaining({
      sourceMetadata: expect.objectContaining({
        kind: 'card_notes_answer',
        taskIds: ['task-a', 'task-c'],
        vaultIds: ['vault-b'],
        cardNotes: [
          { taskId: 'task-a', title: 'Deploy', line: 'prod deploy' },
          { vaultId: 'vault-b', title: 'Fix login', line: 'token bug' },
          { taskId: 'task-c', title: 'Tidy inbox', line: 'inbox zero' },
        ],
      }),
    }))
    expect(appendTaskDescription).toHaveBeenCalledTimes(2)
    expect(appendTaskDescription).toHaveBeenCalledWith('task-a', 'proj-1', 'Notes (via Kairos, 30/09): prod deploy', 10_000)
    expect(appendTaskDescription).toHaveBeenCalledWith('task-c', 'proj-1', 'Notes (via Kairos, 30/09): inbox zero', 10_000)
    expect(updateVaultDescription).toHaveBeenCalledTimes(1)
    expect(updateVaultDescription).toHaveBeenCalledWith('vault-b', 'proj-1', expect.any(Function))
    const compose = vi.mocked(updateVaultDescription).mock.calls[0]![2]
    expect(compose(null)).toBe('Notes (via Kairos, 30/09): token bug')
    expect(compose('Old desc')).toBe('Old desc\n\nNotes (via Kairos, 30/09): token bug')
  })

  it('reports vaulted outcomes: written, gone, over-length, and viewer-skipped', async () => {
    const at = new Date('2026-09-30T09:00:00Z')
    const vaulted = { card: CARDS[1]!, line: 'token bug' }

    await expect(writeBackCardNotes('user-1', [vaulted], at)).resolves.toEqual([
      { vaultId: 'vault-b', status: 'written' },
    ])

    vi.mocked(updateVaultDescription).mockResolvedValueOnce('not_found')
    await expect(writeBackCardNotes('user-1', [vaulted], at)).resolves.toEqual([
      { vaultId: 'vault-b', status: 'memory_only', reason: 'card_gone' },
    ])

    vi.mocked(updateVaultDescription).mockImplementationOnce(async (_v, _p, compose) =>
      compose('x'.repeat(10_000)) === null ? 'rejected' : 'written')
    await expect(writeBackCardNotes('user-1', [vaulted], at)).resolves.toEqual([
      { vaultId: 'vault-b', status: 'skipped', reason: 'description_too_long' },
    ])

    vi.mocked(updateVaultDescription).mockClear()
    vi.mocked(verifyProjectAccess).mockResolvedValueOnce({ project: {}, role: 'viewer' } as never)
    await expect(writeBackCardNotes('user-1', [vaulted], at)).resolves.toEqual([
      { vaultId: 'vault-b', status: 'skipped', reason: 'no_edit_access' },
    ])
    expect(updateVaultDescription).not.toHaveBeenCalled()
  })

  it('writes the whole answer onto a single card', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(cardAsk([CARDS[0]!]))

    await answerKairosAsk(USER, ASK_ID, 'The feed deploy to prod.')

    expect(appendTaskDescription).toHaveBeenCalledWith('task-a', 'proj-1', 'Notes (via Kairos, 30/09): The feed deploy to prod.', 10_000)
  })

  it('keeps an unparseable answer only as memory', async () => {
    const result = await answerKairosAsk(USER, ASK_ID, 'they were all just chores really')

    expect(result).toEqual({ reflectionId: 'reflection-1' })
    expect(captureReflection).toHaveBeenCalledWith(USER, expect.objectContaining({
      bodyMd: 'they were all just chores really',
      sourceMetadata: expect.objectContaining({ taskIds: ['task-a', 'task-c'], cardNotes: [] }),
    }))
    expect(appendTaskDescription).not.toHaveBeenCalled()
  })

  it('never fails the answer when write-back throws, and skips viewers', async () => {
    vi.mocked(appendTaskDescription).mockRejectedValue(new Error('db down'))
    vi.mocked(verifyProjectAccess).mockResolvedValueOnce({ project: {}, role: 'viewer' } as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(answerKairosAsk(USER, ASK_ID, '1. a\n3. c')).resolves.toEqual({ reflectionId: 'reflection-1' })
    expect(appendTaskDescription).toHaveBeenCalledTimes(1) // task-a skipped (viewer), task-c attempted
    errorSpy.mockRestore()
  })

  it('does not write back when the claim race is lost', async () => {
    vi.mocked(markKairosAskAnswered).mockResolvedValue(false as never)

    await expect(answerKairosAsk(USER, ASK_ID, '1. a')).resolves.toEqual({ error: 'not_found' })
    expect(appendTaskDescription).not.toHaveBeenCalled()
  })
})
