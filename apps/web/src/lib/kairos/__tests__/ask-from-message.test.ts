import { beforeEach, describe, expect, it, vi } from 'vitest'

// Triad relay (answer_asks_from_message): a thread reply under a "Vorath asks
// (Q14)" card answers Q14 with no "Q14:" prefix, stamped as agent-relayed.
// The 08/10 miss: the owner's thread reply fell through to chat instead.

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

import { getOpenKairosAskById, listOpenKairosAsks, markKairosAskAnswered, type KairosAskRow } from '@/lib/data/ask'
import { captureReflection } from '@/lib/data/memories'
import { recordToday } from '../today'
import { answerNumberedKairosAsks } from '../ask'
import { formatNumberedAck } from '../ask-numbered'

const USER = 'user-1'
const DOM = '99999999-9999-4999-8999-999999999999'
const RELAY = { kind: 'agent', via: 'mcp' } as const
const ask = (seq: number, id: string) => ({
  id,
  seq,
  title: `Question ${seq}`,
  summary: null,
  dominionId: DOM,
  createdAt: new Date('2026-10-08T03:41:00Z'),
  kairosAsk: { status: 'pending', seq, aetherMemoryId: 'aether-1', sourceThoughtId: null, sourceMemoryIds: [], dominionId: DOM, askedAt: '2026-10-08T03:41:00.000Z' },
}) satisfies KairosAskRow & { seq: number }
const Q13 = ask(13, 'ask-13')
const Q14 = ask(14, 'ask-14')
const Q14_CARD = '**Vorath asks (Q14)**\n\n2 cards closed with no notes\n1. Swarm Phase 1 Data rebuild\n2. Paper Researcher\n\nReply `Q14: your answer`'
const REPLY = 'So the Swarm phase one data rebuild replaced Enapsis with EPEX SFTP. Paper Researcher is a prototype harness that scans papers.'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listOpenKairosAsks).mockResolvedValue([Q13, Q14] as never)
  vi.mocked(getOpenKairosAskById).mockImplementation(async (_u, id) => (id === Q14.id ? Q14 : id === Q13.id ? Q13 : null))
  vi.mocked(captureReflection).mockResolvedValue({ ok: true, memory: { id: 'reflection-1' } } as never)
  vi.mocked(markKairosAskAnswered).mockResolvedValue(true as never)
})

describe('answerNumberedKairosAsks — Triad thread replies', () => {
  it('a thread reply under the Q14 card answers Q14, relayed by an agent', async () => {
    const outcome = await answerNumberedKairosAsks(USER, REPLY, new Date(), Q14_CARD, RELAY)

    expect(outcome).toEqual({ matched: true, answered: [14], skipped: [], failed: [], stillOpen: [13] })
    expect(captureReflection).toHaveBeenCalledOnce()
    expect(vi.mocked(recordToday).mock.calls[0][2]).toEqual(RELAY)
    if (outcome.matched) expect(formatNumberedAck(outcome)).toBe('✓ Q14 · still open: Q13')
  })

  it('the same text with no card is ordinary chat', async () => {
    await expect(answerNumberedKairosAsks(USER, REPLY, new Date(), undefined, RELAY)).resolves.toEqual({ matched: false })
    expect(captureReflection).not.toHaveBeenCalled()
  })

  it('a question back to Vorath under the card is not an answer', async () => {
    await expect(answerNumberedKairosAsks(USER, 'which cards do you mean?', new Date(), Q14_CARD, RELAY)).resolves.toEqual({ matched: false })
  })

  it('a quoted message naming two questions is ambiguous, so it stays chat', async () => {
    await expect(answerNumberedKairosAsks(USER, REPLY, new Date(), 'Open: Q13 and Q14', RELAY)).resolves.toEqual({ matched: false })
  })
})
