import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// decideKairosProposal — the one decision function for owner-decided
// proposals (Phase 2, Track C). The goal kind's transitions are the claim;
// the decision record is stamped once after; agents and unregistered kinds
// are refused; expiry is swept without a negative reaction.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/proposal-decision', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/proposal-decision')>()
  return {
    readDecision: actual.readDecision,
    readTelegramRef: actual.readTelegramRef,
    findProposalForDecision: vi.fn(),
    recordProposalDecision: vi.fn(async () => true),
    listExpiredTelegramProposals: vi.fn(async () => []),
    markTelegramClosed: vi.fn(async () => undefined),
  }
})
vi.mock('@/lib/data/goals', () => ({ casGoalUpdate: vi.fn() }))
vi.mock('@/lib/data/voice-samples', () => ({ VOICE_SAMPLE_KIND: 'voice_sample', casVoiceSampleStatus: vi.fn(), expireVoiceSamples: vi.fn(async () => []) }))
vi.mock('../goals/transitions', () => ({ approveGoal: vi.fn(), vetoGoal: vi.fn(), expireStaleGoals: vi.fn() }))
vi.mock('../promises/create', () => ({ createKairosPromises: vi.fn() }))
vi.mock('../reactions', () => ({ reactOutcome: vi.fn(async () => undefined) }))

import {
  findProposalForDecision,
  listExpiredTelegramProposals,
  markTelegramClosed,
  recordProposalDecision,
} from '@/lib/data/proposal-decision'
import { casGoalUpdate } from '@/lib/data/goals'
import { approveGoal, expireStaleGoals, vetoGoal } from '../goals/transitions'
import { createKairosPromises } from '../promises/create'
import { reactOutcome } from '../reactions'
import {
  applyVetoReason,
  decideKairosProposal,
  goalPromiseOutcome,
  isDecidableProposalKind,
  sweepExpiredProposals,
} from '../proposal-decision'

const USER = 'user-1'
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-02T09:00:00.000Z')

function pendingGoalRow(extra: Record<string, unknown> = {}) {
  return {
    id: GOAL_ID,
    title: 'Why do Monday boards drift?',
    type: 'inbound',
    archivedAt: null,
    sourceMetadata: {
      kind: 'goal',
      status: 'pending',
      expiresAt: '2026-10-04T09:00:00.000Z',
      goal: { state: 'proposed' },
      ...extra,
    },
  }
}

function approvedGoal(dueAt = '2026-10-09T23:30:00.000Z') {
  return {
    id: GOAL_ID,
    title: 'Why do Monday boards drift?',
    type: 'kairos_goal',
    dominionId: null,
    archivedAt: null,
    createdAt: NOW,
    meta: { question: 'What makes Monday boards drift from the plan?', dueAt } as never,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(recordProposalDecision).mockResolvedValue(true)
  vi.mocked(listExpiredTelegramProposals).mockResolvedValue([])
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: true }) })
  vi.stubGlobal('fetch', fetchMock)
  process.env.TELEGRAM_BOT_TOKEN = 'bot'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = '12345'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
})

describe('registry', () => {
  it('registers goal and voice_sample only', () => {
    expect(isDecidableProposalKind('goal')).toBe(true)
    expect(isDecidableProposalKind('voice_sample')).toBe(true)
    expect(isDecidableProposalKind('idea')).toBe(false)
    expect(isDecidableProposalKind('toString')).toBe(false)
    expect(isDecidableProposalKind(undefined)).toBe(false)
  })
})

describe('decideKairosProposal — refusals before any effect', () => {
  it('not_found for a missing row', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(null)
    expect(await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('not_decidable for an unregistered kind (caller falls back)', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue({ ...pendingGoalRow(), sourceMetadata: { kind: 'idea', status: 'pending' } })
    expect(await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'not_decidable' })
    expect(approveGoal).not.toHaveBeenCalled()
  })

  it('forbidden_actor for an agent origin', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow())
    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW, origin: { kind: 'agent', via: 'mcp' } })
    expect(res).toMatchObject({ ok: false, reason: 'forbidden_actor' })
    expect(approveGoal).not.toHaveBeenCalled()
  })

  it('already_decided when a decision is recorded (repeat tap does nothing)', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow({ decision: { verdict: 'veto', via: 'telegram', at: NOW.toISOString(), reason: null, awaitingReason: false } }))
    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'telegram', now: NOW })
    expect(res).toEqual({ ok: false, reason: 'already_decided', title: 'Why do Monday boards drift?', decided: 'veto' })
    expect(approveGoal).not.toHaveBeenCalled()
    expect(recordProposalDecision).not.toHaveBeenCalled()
  })

  it('expired once past expiresAt, even before the sweep ran', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow({ expiresAt: '2026-10-02T08:59:59.000Z' }))
    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'telegram', now: NOW })
    expect(res).toMatchObject({ ok: false, reason: 'expired' })
    expect(approveGoal).not.toHaveBeenCalled()
  })
})

describe('decideKairosProposal — goal approve', () => {
  it('approves as the operator, creates the goal promise due on the London date, records once, reacts', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow())
    vi.mocked(createKairosPromises).mockResolvedValue({ created: [{} as never], rejected: [], overflow: 0 })
    vi.mocked(approveGoal).mockImplementation(async (_u, _g, _a, opts) => {
      await opts?.onApproved?.(approvedGoal() as never)
      return { ok: true, goal: approvedGoal() as never }
    })

    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'telegram', now: NOW })

    expect(res).toEqual({ ok: true, verdict: 'approve', title: 'Why do Monday boards drift?', kind: 'goal', memoryId: GOAL_ID })
    expect(approveGoal).toHaveBeenCalledWith(USER, GOAL_ID, { kind: 'operator', via: 'telegram' }, expect.objectContaining({ now: NOW }))
    // dueAt 23:30Z on 9 Oct is 00:30 on 10 Oct in London (BST).
    expect(createKairosPromises).toHaveBeenCalledWith(
      USER,
      [{ outcome: 'Report back on: What makes Monday boards drift from the plan?', dueDate: '2026-10-10' }],
      { kind: 'goal', goalId: GOAL_ID },
      NOW,
    )
    expect(recordProposalDecision).toHaveBeenCalledTimes(1)
    expect(recordProposalDecision).toHaveBeenCalledWith(USER, GOAL_ID, {
      verdict: 'approve', via: 'telegram', at: NOW.toISOString(), reason: null, awaitingReason: false,
    }, NOW)
    expect(reactOutcome).toHaveBeenCalledWith(USER, GOAL_ID, 'positive', 'proposal approved')
    // Telegram path edits its own message; nothing else here.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a lost compare-and-set (second tap / web + Telegram race) is already_decided and records nothing', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow())
    vi.mocked(approveGoal).mockResolvedValue({ ok: false, reason: 'already_resolved' })
    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })
    expect(res).toMatchObject({ ok: false, reason: 'already_decided' })
    expect(recordProposalDecision).not.toHaveBeenCalled()
    expect(reactOutcome).not.toHaveBeenCalled()
  })

  it('cap_reached records nothing so the owner can decide again later', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow())
    vi.mocked(approveGoal).mockResolvedValue({ ok: false, reason: 'cap_reached' })
    expect(await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'cap_reached' })
    expect(recordProposalDecision).not.toHaveBeenCalled()
  })

  it('a web decision strips the live Telegram buttons and marks them closed', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow({ telegram: { chatId: '12345', messageId: 9 } }))
    vi.mocked(approveGoal).mockResolvedValue({ ok: true, goal: approvedGoal() as never })

    await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/editMessageText$/)
    expect(JSON.parse(init.body)).toEqual({
      chat_id: '12345', message_id: 9, text: 'Why do Monday boards drift?\n\n— Approved in Aeon ✓', reply_markup: { inline_keyboard: [] },
    })
    expect(markTelegramClosed).toHaveBeenCalledWith(USER, GOAL_ID, NOW)
  })
})

describe('decideKairosProposal — goal veto', () => {
  it('vetoes with the reason as the goal note and records it', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow())
    vi.mocked(vetoGoal).mockResolvedValue({ ok: true, goal: approvedGoal() as never })

    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'veto', reason: '  not useful  ', via: 'inbox', now: NOW })

    expect(res).toMatchObject({ ok: true, verdict: 'veto' })
    expect(vetoGoal).toHaveBeenCalledWith(USER, GOAL_ID, { kind: 'operator', via: 'inbox' }, { now: NOW, note: 'not useful' })
    expect(recordProposalDecision).toHaveBeenCalledWith(USER, GOAL_ID, expect.objectContaining({ verdict: 'veto', reason: 'not useful', awaitingReason: false }), NOW)
    expect(reactOutcome).toHaveBeenCalledWith(USER, GOAL_ID, 'negative', 'proposal vetoed')
  })

  it('"Veto + why" leaves the reason awaited', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(pendingGoalRow())
    vi.mocked(vetoGoal).mockResolvedValue({ ok: true, goal: approvedGoal() as never })
    await decideKairosProposal(USER, GOAL_ID, { verdict: 'veto', wantsReason: true, via: 'telegram', now: NOW })
    expect(recordProposalDecision).toHaveBeenCalledWith(USER, GOAL_ID, expect.objectContaining({ reason: null, awaitingReason: true }), NOW)
  })

  it('a later reason is written onto the vetoed goal', async () => {
    await applyVetoReason(USER, GOAL_ID, 'goal', 'too vague', NOW)
    expect(casGoalUpdate).toHaveBeenCalledWith(USER, GOAL_ID, 'vetoed', { goal: { vetoNote: 'too vague' } }, NOW)
    await applyVetoReason(USER, GOAL_ID, 'idea', 'x', NOW)
    expect(casGoalUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('goalPromiseOutcome', () => {
  it('falls back to the title when the question is too long or vague', () => {
    expect(goalPromiseOutcome({ title: 'Board drift', meta: { question: 'q'.repeat(200) } as never })).toBe('Report back on: Board drift')
    expect(goalPromiseOutcome({ title: 'Board drift', meta: { question: 'Should we look into drift?' } as never })).toBe('Report back on: Board drift')
  })
})

describe('sweepExpiredProposals', () => {
  it('expires stale goals, replaces the buttons with "— Expired, no action", no negative reaction', async () => {
    vi.mocked(expireStaleGoals).mockResolvedValue({ expired: [GOAL_ID], timedOut: [] })
    vi.mocked(listExpiredTelegramProposals).mockResolvedValue([{ id: GOAL_ID, title: 'Drift', telegram: { chatId: '12345', messageId: 9 } }])

    const res = await sweepExpiredProposals(USER, NOW)

    expect(res).toEqual({ expired: 1, telegramCleared: 1 })
    expect(expireStaleGoals).toHaveBeenCalledWith(USER, NOW)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ chat_id: '12345', message_id: 9, text: 'Drift\n\n— Expired, no action', reply_markup: { inline_keyboard: [] } })
    expect(markTelegramClosed).toHaveBeenCalledWith(USER, GOAL_ID, NOW)
    expect(reactOutcome).not.toHaveBeenCalled()
  })

  it('without Telegram configured it only expires', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    vi.mocked(expireStaleGoals).mockResolvedValue({ expired: [], timedOut: [] })
    expect(await sweepExpiredProposals(USER, NOW)).toEqual({ expired: 0, telegramCleared: 0 })
    expect(listExpiredTelegramProposals).not.toHaveBeenCalled()
  })
})
