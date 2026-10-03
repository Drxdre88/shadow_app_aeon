import { beforeEach, describe, expect, it, vi } from 'vitest'

// One mind (spec_one_mind): a claimed Q answer lands in the today log once,
// stamped with the origin the caller passed (never re-derived from the text);
// a lost claim race records nothing.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/aether', () => ({ getLatestAether: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({
  getPriorAethers: vi.fn(),
  getReflectionsSince: vi.fn(),
  getPendingKairosAsk: vi.fn(),
  getOpenKairosAskById: vi.fn(),
  listOpenKairosAsks: vi.fn(),
  markKairosAskDismissed: vi.fn(),
  getNewestKairosAsk: vi.fn(),
  createKairosAskMemory: vi.fn(),
  markKairosAskAnswered: vi.fn(),
  archiveOrphanAnswerMemory: vi.fn(),
}))
vi.mock('@/lib/data/memories', () => ({ captureReflection: vi.fn(), markKairosSpeaksReplied: vi.fn(async () => 0) }))
vi.mock('@/lib/data/tasks', () => ({ findTaskById: vi.fn(), appendTaskDescription: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: vi.fn() }))
vi.mock('@/lib/data/vault', () => ({ updateVaultDescription: vi.fn() }))
vi.mock('@/lib/kairos/reactions', () => ({ reactUsed: vi.fn(async () => undefined), reactOutcome: vi.fn(async () => undefined) }))
vi.mock('../today', () => ({ recordToday: vi.fn(async () => undefined) }))

import { archiveOrphanAnswerMemory, getOpenKairosAskById, listOpenKairosAsks, markKairosAskAnswered, type KairosAskRow } from '@/lib/data/ask'
import { captureReflection } from '@/lib/data/memories'
import { recordToday } from '../today'
import { answerKairosAsk, answerNumberedKairosAsks } from '../ask'

const USER = 'user-1'
const ASK_ID = 'ask-1'
const DOM = '99999999-9999-4999-8999-999999999999'
const pending: KairosAskRow = {
  id: ASK_ID,
  title: 'Which board ships first?',
  summary: null,
  dominionId: DOM,
  createdAt: new Date('2026-10-02T08:00:00Z'),
  kairosAsk: {
    status: 'pending',
    seq: 12,
    aetherMemoryId: 'aether-1',
    sourceThoughtId: null,
    sourceMemoryIds: [],
    dominionId: DOM,
    askedAt: '2026-10-02T08:00:00.000Z',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOpenKairosAskById).mockResolvedValue(pending)
  vi.mocked(captureReflection).mockResolvedValue({ ok: true, memory: { id: 'reflection-1' } } as never)
  vi.mocked(markKairosAskAnswered).mockResolvedValue(true as never)
})

describe('answerKairosAsk — today log', () => {
  it('records one "answered" entry with the caller origin passed through', async () => {
    await answerKairosAsk(USER, ASK_ID, 'Aeon first.', undefined, { kind: 'operator', via: 'telegram' })

    expect(recordToday).toHaveBeenCalledOnce()
    expect(recordToday).toHaveBeenCalledWith(
      USER,
      {
        key: `ask:${ASK_ID}`,
        channel: 'telegram',
        type: 'answered',
        text: 'Q12 (Which board ships first?): Aeon first.',
        ref: { askId: ASK_ID, memoryId: 'reflection-1' },
        covered: 'ask-reflection',
      },
      { kind: 'operator', via: 'telegram' },
    )
  })

  it('an agent-origin answer stays agent (MCP), and the default origin is agent', async () => {
    await answerKairosAsk(USER, ASK_ID, 'Aeon first.', undefined, { kind: 'agent', via: 'mcp' })
    await answerKairosAsk(USER, ASK_ID, 'Aeon first.')

    expect(vi.mocked(recordToday).mock.calls.map((c) => [c[1].channel, c[2]])).toEqual([
      ['mcp', { kind: 'agent', via: 'mcp' }],
      ['ask', { kind: 'agent', via: 'ask' }],
    ])
  })

  it('records nothing when the claim race is lost or the ask is gone', async () => {
    vi.mocked(markKairosAskAnswered).mockResolvedValueOnce(false as never)
    await expect(answerKairosAsk(USER, ASK_ID, 'Aeon first.')).resolves.toEqual({ error: 'not_found' })
    expect(archiveOrphanAnswerMemory).toHaveBeenCalled()

    vi.mocked(getOpenKairosAskById).mockResolvedValueOnce(null)
    await answerKairosAsk(USER, ASK_ID, 'Aeon first.')

    expect(recordToday).not.toHaveBeenCalled()
  })

  it('numbered "Q12:" answers are recorded as the operator', async () => {
    vi.mocked(listOpenKairosAsks).mockResolvedValue([{ ...pending, seq: 12 }] as never)

    await answerNumberedKairosAsks(USER, 'Q12: Aeon first.')

    expect(recordToday).toHaveBeenCalledOnce()
    expect(vi.mocked(recordToday).mock.calls[0][2]).toEqual({ kind: 'operator', via: 'ask' })
  })
})
