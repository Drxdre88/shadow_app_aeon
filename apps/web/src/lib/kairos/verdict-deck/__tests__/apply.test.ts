import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../proposal-accept', () => ({
  acceptInboxProposal: vi.fn(async (_u: string, id: string) => ({ ok: true, id })),
  dismissInboxMemory: vi.fn(async (_u: string, id: string) => ({ ok: true, id })),
}))
vi.mock('../../ask', () => ({ dismissKairosAsk: vi.fn(async (_u: string, id: string) => ({ ok: true, id })) }))
vi.mock('../../predictions/verdict', () => ({ settleKairosPredictionByOwner: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../predictions/flag', () => ({ predictionsEnabled: vi.fn(() => true) }))
vi.mock('../../proposal-decision', () => ({ decideKairosProposal: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../idea-verdict-telegram', () => ({ TELEGRAM_OWNER_ORIGIN: { kind: 'operator', via: 'telegram' } }))

import { acceptInboxProposal, dismissInboxMemory } from '../../proposal-accept'
import { dismissKairosAsk } from '../../ask'
import { settleKairosPredictionByOwner } from '../../predictions/verdict'
import { predictionsEnabled } from '../../predictions/flag'
import { decideKairosProposal } from '../../proposal-decision'
import { applyDeckTokens } from '../apply'
import { formatDeckAck } from '../parse'
import type { DeckItem } from '../types'

const USER = 'u1'
const NOW = new Date('2026-10-11T09:00:00.000Z')
const OWNER = { kind: 'operator', via: 'telegram' }
const ITEMS: DeckItem[] = [
  { n: 1, kind: 'idea', id: 'idea-1', label: null, title: 'Idea' },
  { n: 2, kind: 'ask', id: 'ask-1', label: 'Q4', title: 'Ship?' },
  { n: 3, kind: 'prediction', id: 'pred-1', label: 'R2', title: 'Beta lands' },
  { n: 4, kind: 'proposal', id: 'goal-1', label: 'Goal', title: 'Close Atlas' },
]
const ALL = [acceptInboxProposal, dismissInboxMemory, dismissKairosAsk, settleKairosPredictionByOwner, decideKairosProposal]
const words = (out: Awaited<ReturnType<typeof applyDeckTokens>>) => out.map((o) => ('word' in o ? o.word : o.status))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(predictionsEnabled).mockReturnValue(true)
})

describe('applyDeckTokens', () => {
  it('yes routes each kind to its owner handler with operator / telegram origin; a question asks for words', async () => {
    const out = await applyDeckTokens(USER, ITEMS, [1, 2, 3, 4].map((n) => ({ n, verdict: 'yes' as const })), NOW)
    expect(acceptInboxProposal).toHaveBeenCalledWith(USER, 'idea-1', OWNER)
    expect(dismissKairosAsk).not.toHaveBeenCalled()
    expect(settleKairosPredictionByOwner).toHaveBeenCalledWith(USER, 'pred-1', 'right', { via: 'telegram' }, NOW)
    expect(decideKairosProposal).toHaveBeenCalledWith(USER, 'goal-1', { verdict: 'approve', via: 'telegram', now: NOW, origin: OWNER })
    expect(words(out)).toEqual(['kept', 'Q4: …', 'right', 'approved'])
    expect(formatDeckAck(out)).toBe('✓ 1 kept · 2 reply "Q4: …" with your answer · ✓ 3 right · ✓ 4 approved')
  })

  it('no routes to the negative handler; a question is set aside, never answered "no"', async () => {
    const out = await applyDeckTokens(USER, ITEMS, [1, 2, 3, 4].map((n) => ({ n, verdict: 'no' as const })), NOW)
    expect(dismissInboxMemory).toHaveBeenCalledWith(USER, 'idea-1', OWNER)
    expect(dismissKairosAsk).toHaveBeenCalledWith(USER, 'ask-1', NOW)
    expect(settleKairosPredictionByOwner).toHaveBeenCalledWith(USER, 'pred-1', 'wrong', { via: 'telegram' }, NOW)
    expect(decideKairosProposal).toHaveBeenCalledWith(USER, 'goal-1', { verdict: 'veto', via: 'telegram', now: NOW, origin: OWNER })
    expect(acceptInboxProposal).not.toHaveBeenCalled()
    expect(words(out)).toEqual(['dropped', 'set aside', 'wrong', 'vetoed'])
  })

  it('skip never changes anything; unknown numbers are reported', async () => {
    const out = await applyDeckTokens(USER, ITEMS, [
      ...[1, 2, 3, 4].map((n) => ({ n, verdict: 'skip' as const })),
      { n: 11, verdict: 'yes' as const },
    ], NOW)
    for (const fn of ALL) expect(fn).not.toHaveBeenCalled()
    expect(out).toEqual([
      ...[1, 2, 3, 4].map((n) => ({ n, status: 'skipped' })),
      { n: 11, status: 'unknown' },
    ])
  })

  it('already handled, a thrown handler and predictions switched off', async () => {
    vi.mocked(acceptInboxProposal).mockResolvedValueOnce({ ok: false, reason: 'already_resolved' } as never)
    vi.mocked(dismissKairosAsk).mockRejectedValueOnce(new Error('db down'))
    vi.mocked(predictionsEnabled).mockReturnValue(false)
    const out = await applyDeckTokens(USER, ITEMS, [
      { n: 1, verdict: 'yes' as const }, { n: 2, verdict: 'no' as const }, { n: 3, verdict: 'yes' as const },
    ], NOW)
    expect(out).toEqual([{ n: 1, status: 'already_handled' }, { n: 2, status: 'failed' }, { n: 3, status: 'unknown' }])
    expect(settleKairosPredictionByOwner).not.toHaveBeenCalled()
  })
})
