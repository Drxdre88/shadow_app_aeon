import { beforeEach, describe, expect, it, vi } from 'vitest'

// The 06:00 "I dreamt…" line: composed beside the message (never inside it),
// handed to speak as a Telegram-only tail, returned by dry runs, and only
// when dreamLineEnabled(). The model prompt never sees it.

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
vi.mock('../dreams/flag', () => ({ dreamLineEnabled: vi.fn() }))
vi.mock('../dreams/line', () => ({ readDreamLine: vi.fn() }))
vi.mock('@/lib/data/idea-expiry', () => ({ expireStaleIdeaProposals: vi.fn(async () => []) }))

import { getProviderForTask } from '@/lib/ai/route-task'
import { deliverKairosSpeak } from '../speak'
import { gatherDailyMessageInputs } from '../daily-message-inputs'
import { dreamLineEnabled } from '../dreams/flag'
import { readDreamLine } from '../dreams/line'
import type { DailyMessageInputs } from '../daily-message-prompt'
import { composeDailyMessage, runDailyMessageForUser } from '../daily-message'

const USER = 'user-1'
const NOW = new Date('2026-10-03T05:00:00.000Z') // Saturday 06:00 London
const LINE = '💭 I dreamt the desk drifted out to sea.'
const INPUTS = {
  date: '2026-10-03', isMonday: false, areas: [{ dominion: 'AEON', headline: 'Ship it.' }], aether: null,
  boardDay: { finished: 0, finishedTitles: [], thinCards: 0 }, promotions: [], newBeliefs: [], drift: null,
  openAsks: null, synthesis: null, mindCompare: null, failed: [],
} as unknown as DailyMessageInputs
const ask = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(gatherDailyMessageInputs).mockResolvedValue(INPUTS)
  vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
  ask.mockResolvedValue({ text: '{"message": "**Today** model text."}', finishReason: 'stop' })
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
  vi.mocked(readDreamLine).mockResolvedValue(LINE)
  vi.mocked(dreamLineEnabled).mockReturnValue(true)
})

describe('daily message dream line', () => {
  it('compose returns the line beside the message, never inside it or the model prompt', async () => {
    const { message, dreamLine } = await composeDailyMessage(USER, NOW)
    expect(dreamLine).toBe(LINE)
    expect(message).not.toContain('dreamt')
    expect(JSON.stringify(ask.mock.calls)).not.toContain('dreamt')
    expect(readDreamLine).toHaveBeenCalledWith(USER, NOW)
  })

  it('delivery passes the line only as the Telegram tail', async () => {
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'sent' })
    const [user, input, opts] = vi.mocked(deliverKairosSpeak).mock.calls[0]
    expect(user).toBe(USER)
    expect(input.message).not.toContain('dreamt')
    expect(opts).toMatchObject({ telegramTail: LINE })
    expect(opts?.telegramText).not.toContain('dreamt')
  })

  it('dry run returns the line', async () => {
    expect(await runDailyMessageForUser(USER, { now: NOW, dryRun: true })).toMatchObject({ status: 'dry_run', dreamLine: LINE })
    expect(deliverKairosSpeak).not.toHaveBeenCalled()
  })

  it('flag off: no lookup, no Telegram tail', async () => {
    vi.mocked(dreamLineEnabled).mockReturnValue(false)
    expect((await composeDailyMessage(USER, NOW)).dreamLine).toBeNull()
    await runDailyMessageForUser(USER, { now: NOW })
    expect(readDreamLine).not.toHaveBeenCalled()
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]).not.toHaveProperty('telegramTail')
    expect(await runDailyMessageForUser(USER, { now: NOW, dryRun: true })).not.toHaveProperty('dreamLine')
  })

  it('no line today (off-day / no read): no Telegram tail', async () => {
    vi.mocked(readDreamLine).mockResolvedValue(null)
    await runDailyMessageForUser(USER, { now: NOW })
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]).not.toHaveProperty('telegramTail')
  })
})
