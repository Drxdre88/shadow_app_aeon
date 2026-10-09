import { beforeEach, describe, expect, it, vi } from 'vitest'

// 06:00 delivery × the Sunday verdict deck: on Sunday (London) the Telegram
// brief becomes the numbered deck and its number → item mapping is stored
// against the sent message id; any other day sends the ordinary brief.

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  chain.from = pass
  chain.where = pass
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve([{ n: 0 }])
  return {
    db: {
      select: vi.fn(() => chain),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ execute: vi.fn(async () => ({ rows: [{ locked: true }] })) })),
    },
  }
})
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn(async () => []) }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('../speak', () => ({ deliverKairosSpeak: vi.fn() }))
vi.mock('../cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('../daily-message-inputs', () => ({ gatherDailyMessageInputs: vi.fn() }))
vi.mock('../conscience-context', () => ({ loadConscienceBlock: vi.fn(async () => '') }))
vi.mock('../promises/check', () => ({ PROMISE_CHECK_CRON: 'promise-check', verifyOpenPromises: vi.fn() }))
vi.mock('../dreams/flag', () => ({ dreamLineEnabled: vi.fn(() => false) }))
vi.mock('@/lib/data/idea-expiry', () => ({ expireStaleIdeaProposals: vi.fn(async () => []) }))
vi.mock('../verdict-deck/gather', () => ({ gatherDeckCandidates: vi.fn() }))
vi.mock('@/lib/data/kairos-verdict-deck', () => ({ saveVerdictDeck: vi.fn(async () => undefined) }))

import { getProviderForTask } from '@/lib/ai/route-task'
import { saveVerdictDeck } from '@/lib/data/kairos-verdict-deck'
import { deliverKairosSpeak } from '../speak'
import { writeCronFailureTrace } from '../cron-trace'
import { gatherDailyMessageInputs } from '../daily-message-inputs'
import type { DailyMessageInputs } from '../daily-message-prompt'
import { gatherDeckCandidates } from '../verdict-deck/gather'
import { runDailyMessageForUser } from '../daily-message'

const USER = 'user-1'
const SUNDAY = new Date('2026-10-11T05:00:00.000Z') // 06:00 BST
const SATURDAY = new Date('2026-10-10T05:00:00.000Z')
const INPUTS: DailyMessageInputs = {
  date: '2026-10-11', isMonday: false, areas: [{ dominion: 'AEON', headline: 'Ship it.' }], aether: null,
  boardDay: null, promotions: [], newBeliefs: [], drift: null, synthesis: null, mindCompare: null, failed: [],
  openAsks: [{ seq: 4, question: 'Ship Friday?', askedAt: '2026-10-08T04:30:00.000Z' }],
}
const ask = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(gatherDailyMessageInputs).mockResolvedValue(INPUTS)
  vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
  ask.mockResolvedValue({ text: '{"message": "**A calm week.**\\nAEON: ship it."}', finishReason: 'stop' })
  vi.mocked(gatherDeckCandidates).mockResolvedValue({
    failed: [],
    candidates: [
      { kind: 'ask', id: 'ask-4', label: 'Q4', title: 'Ship Friday?', since: '2026-10-08T04:30:00.000Z' },
      { kind: 'idea', id: 'idea-1', label: null, title: 'Cut the PPA scope', since: '2026-10-06T03:40:00.000Z' },
    ],
  })
  vi.mocked(deliverKairosSpeak).mockImplementation(async (_u, _i, opts) => {
    opts?.telegramOnSent?.(777)
    return { status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } }
  })
})

describe('06:00 delivery — Sunday verdict deck', () => {
  it('Sunday: Telegram gets the numbered deck and the mapping is stored under the sent message id', async () => {
    expect(await runDailyMessageForUser(USER, { now: SUNDAY })).toMatchObject({ status: 'sent' })
    const opts = vi.mocked(deliverKairosSpeak).mock.calls[0][2]
    expect(opts?.telegramText).toBe([
      '**A calm week.**',
      '1. 💡 Cut the PPA scope\n2. Q4 · Ship Friday?',
      'Reply e.g. "1y 2n 3 skip"',
    ].join('\n\n'))
    expect(JSON.stringify(opts?.telegramKeyboard ?? [])).not.toContain('Keep')
    expect(saveVerdictDeck).toHaveBeenCalledWith(USER, {
      v: 1, date: '2026-10-11', messageIds: [777],
      items: [
        { n: 1, kind: 'idea', id: 'idea-1', label: null, title: 'Cut the PPA scope' },
        { n: 2, kind: 'ask', id: 'ask-4', label: 'Q4', title: 'Ship Friday?' },
      ],
    })
  })

  it('any other day: the ordinary brief, no deck read or stored', async () => {
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({ ...INPUTS, date: '2026-10-10' })
    await runDailyMessageForUser(USER, { now: SATURDAY })
    expect(gatherDeckCandidates).not.toHaveBeenCalled()
    expect(saveVerdictDeck).not.toHaveBeenCalled()
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]?.telegramText).toContain('Q4 · Ship Friday?')
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]?.telegramText).not.toContain('Reply e.g.')
  })

  it('Sunday with nothing waiting: the quiet-day line, nothing stored', async () => {
    vi.mocked(gatherDeckCandidates).mockResolvedValue({ failed: [], candidates: [] })
    await runDailyMessageForUser(USER, { now: SUNDAY })
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]?.telegramText).toBe('**Quiet night — nothing needs your verdict today.**')
    expect(saveVerdictDeck).not.toHaveBeenCalled()
  })

  it('a failed deck compose falls back to the ordinary brief', async () => {
    vi.mocked(gatherDeckCandidates).mockRejectedValue(new Error('db down'))
    expect(await runDailyMessageForUser(USER, { now: SUNDAY })).toMatchObject({ status: 'sent' })
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]?.telegramText).toContain('Q4 · Ship Friday?')
    expect(saveVerdictDeck).not.toHaveBeenCalled()
  })

  it('every source failing never reads as "nothing waiting": the ordinary brief goes out', async () => {
    vi.mocked(gatherDeckCandidates).mockResolvedValue({ failed: ['ideas', 'asks'], candidates: [] })
    await runDailyMessageForUser(USER, { now: SUNDAY })
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]?.telegramText).not.toContain('Quiet night')
    expect(saveVerdictDeck).not.toHaveBeenCalled()
  })

  it('Telegram not delivered: no mapping; a failed save is traced and never costs the message', async () => {
    vi.mocked(deliverKairosSpeak).mockResolvedValueOnce({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: false } } })
    await runDailyMessageForUser(USER, { now: SUNDAY })
    expect(saveVerdictDeck).not.toHaveBeenCalled()

    vi.mocked(saveVerdictDeck).mockRejectedValueOnce(new Error('write failed'))
    expect(await runDailyMessageForUser(USER, { now: SUNDAY })).toMatchObject({ status: 'sent' })
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'verdict-deck', reason: 'save_failed' }))
  })
})
