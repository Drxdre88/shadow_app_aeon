import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 06:00 delivery × Wave 2: the inbox keeps the full message, Telegram gets the
// short brief with Keep / Drop buttons for the idea (no self-Dismiss), and the
// run expires week-old undecided ideas first (never on a dry run).

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

import { getProviderForTask } from '@/lib/ai/route-task'
import { expireStaleIdeaProposals } from '@/lib/data/idea-expiry'
import { deliverKairosSpeak } from '../speak'
import { writeCronFailureTrace } from '../cron-trace'
import { gatherDailyMessageInputs } from '../daily-message-inputs'
import type { DailyMessageInputs } from '../daily-message-prompt'
import { DAILY_BRIEF_MAX_CHARS } from '../daily-brief'
import { runDailyMessageForUser } from '../daily-message'

const USER = 'user-1'
const NOW = new Date('2026-10-09T05:00:00.000Z')
const IDEA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INPUTS: DailyMessageInputs = {
  date: '2026-10-09', isMonday: false, areas: [{ dominion: 'AEON', headline: 'Ship it.' }], aether: null,
  boardDay: null, promotions: [], newBeliefs: [], drift: null, synthesis: null, mindCompare: null, failed: [],
  openAsks: Array.from({ length: 6 }, (_, i) => ({ seq: 20 + i, question: `Question ${20 + i}?`, askedAt: '2026-10-05T04:30:00.000Z' })),
  idea: { id: IDEA_ID, title: 'Cut the PPA scope', claim: 'Cut it', survivedBecause: 'backed by 3 pages', othersWaiting: 0 },
}
const ask = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.AUTH_URL
  delete process.env.NEXTAUTH_URL
  vi.mocked(gatherDailyMessageInputs).mockResolvedValue(INPUTS)
  vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask } } as never)
  ask.mockResolvedValue({ text: '{"message": "**Atlas is close.**\\n**Today**\\nAEON: ship it.\\nNext: beta lands Monday."}', finishReason: 'stop' })
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('06:00 delivery — short brief on Telegram, full text in the inbox', () => {
  it('sends the brief with Keep / Drop for the idea instead of the self-Dismiss', async () => {
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'sent' })
    const [, input, opts] = vi.mocked(deliverKairosSpeak).mock.calls[0]
    expect(input.message).toContain('Open questions (6):')
    expect(input.message).toContain('Q25 · ')
    expect(opts?.telegramText).toMatch(/^\*\*Atlas is close\.\*\*\n/)
    expect(opts?.telegramText!.length).toBeLessThanOrEqual(DAILY_BRIEF_MAX_CHARS)
    expect(opts?.telegramText).toContain('Q20 · Question 20?')
    expect(opts?.telegramText).toContain('+4 more in your inbox.')
    expect(opts?.telegramKeyboard).toEqual([[
      { text: '✅ Keep', callback_data: `accept:${IDEA_ID}` },
      { text: '❌ Drop', callback_data: `dismiss:${IDEA_ID}` },
    ]])
    expect(opts?.telegramDismiss).toBe(false)
  })

  it('no idea: an Open in Aeon link replaces the Dismiss; without an app URL the Dismiss stays', async () => {
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({ ...INPUTS, idea: null })
    process.env.NEXT_PUBLIC_APP_URL = 'https://aeon.example'
    await runDailyMessageForUser(USER, { now: NOW })
    expect(vi.mocked(deliverKairosSpeak).mock.calls[0][2]).toMatchObject({
      telegramKeyboard: [[{ text: 'Open in Aeon', url: 'https://aeon.example/vorath' }]],
      telegramDismiss: false,
    })

    delete process.env.NEXT_PUBLIC_APP_URL
    await runDailyMessageForUser(USER, { now: NOW })
    const opts = vi.mocked(deliverKairosSpeak).mock.calls[1][2]
    expect(opts).not.toHaveProperty('telegramKeyboard')
    expect(opts).not.toHaveProperty('telegramDismiss')
  })

  it('quiet day: Telegram gets one line, never nothing', async () => {
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({ ...INPUTS, idea: null, openAsks: null })
    await runDailyMessageForUser(USER, { now: NOW })
    const opts = vi.mocked(deliverKairosSpeak).mock.calls[0][2]
    expect(opts?.telegramText).toBe('**Quiet night — nothing needs your verdict today.** Next: beta lands Monday.')
  })
})

describe('06:00 delivery — idea expiry', () => {
  it('expires week-old undecided ideas before composing; a dry run never writes', async () => {
    await runDailyMessageForUser(USER, { now: NOW })
    expect(expireStaleIdeaProposals).toHaveBeenCalledWith(USER, NOW)
    expect(vi.mocked(expireStaleIdeaProposals).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(gatherDailyMessageInputs).mock.invocationCallOrder[0])

    vi.mocked(expireStaleIdeaProposals).mockClear()
    const dry = await runDailyMessageForUser(USER, { now: NOW, dryRun: true })
    expect(expireStaleIdeaProposals).not.toHaveBeenCalled()
    expect(dry.brief).toContain('💡 Idea: Cut the PPA scope — Keep or Drop below.')
  })

  it('a failed expiry is traced and never costs the message', async () => {
    vi.mocked(expireStaleIdeaProposals).mockRejectedValueOnce(new Error('db down'))
    expect(await runDailyMessageForUser(USER, { now: NOW })).toMatchObject({ status: 'sent' })
    expect(writeCronFailureTrace).toHaveBeenCalledWith(USER, expect.objectContaining({ cronName: 'idea-expiry', reason: 'expiry_failed' }))
  })
})
