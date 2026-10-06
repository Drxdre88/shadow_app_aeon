import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// voice_sample in the owner-only proposal registry (character check, Lane B):
// approve / veto are compare-and-sets on the row's status (never the generic
// accept that would refile Kairos's text as the owner's), agents are
// refused, and the hourly sweep expires unanswered samples.

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
vi.mock('@/lib/data/voice-samples', () => ({ VOICE_SAMPLE_KIND: 'voice_sample', casVoiceSampleStatus: vi.fn(), expireVoiceSamples: vi.fn() }))
vi.mock('@/lib/data/card-tree-proposals', () => ({ casCardTreeStatus: vi.fn(), expireCardTrees: vi.fn(async () => []), findCardTreeProposal: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ acceptProposal: vi.fn() }))
vi.mock('../goals/transitions', () => ({ approveGoal: vi.fn(), vetoGoal: vi.fn(), expireStaleGoals: vi.fn(async () => ({ expired: [], timedOut: [] })) }))
vi.mock('../promises/create', () => ({ createKairosPromises: vi.fn() }))
vi.mock('../reactions', () => ({ reactOutcome: vi.fn(async () => undefined) }))
vi.mock('../today', () => ({ recordToday: vi.fn(async () => undefined) }))

import { findProposalForDecision, recordProposalDecision } from '@/lib/data/proposal-decision'
import { casVoiceSampleStatus, expireVoiceSamples } from '@/lib/data/voice-samples'
import { acceptProposal } from '@/lib/data/memories'
import { approveGoal } from '../goals/transitions'
import { decideKairosProposal, sweepExpiredProposals } from '../proposal-decision'

const USER = 'user-1'
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = new Date('2026-10-06T09:00:00.000Z')

function sampleRow(meta: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: 'Voice sample — does this sound like him?',
    type: 'inbound',
    archivedAt: null,
    sourceMetadata: {
      kind: 'voice_sample',
      status: 'pending',
      expiresAt: '2026-10-19T04:00:00.000Z',
      voiceSample: { text: 'Ship the smaller change first.', source: 'chat', isoWeek: '2026-W40', expiresAt: '2026-10-19T04:00:00.000Z' },
      ...meta,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findProposalForDecision).mockResolvedValue(sampleRow())
  vi.mocked(casVoiceSampleStatus).mockResolvedValue(true)
  vi.mocked(expireVoiceSamples).mockResolvedValue([])
  delete process.env.TELEGRAM_BOT_TOKEN
})
afterEach(() => { delete process.env.TELEGRAM_BOT_TOKEN })

describe('voice_sample decisions', () => {
  it('approve: pending → approved compare-and-set, decision recorded, no generic accept', async () => {
    const res = await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })
    expect(res).toMatchObject({ ok: true, verdict: 'approve', kind: 'voice_sample' })
    expect(casVoiceSampleStatus).toHaveBeenCalledWith(USER, ID, 'pending', 'approved', NOW)
    expect(recordProposalDecision).toHaveBeenCalledTimes(1)
    expect(acceptProposal).not.toHaveBeenCalled()
    expect(approveGoal).not.toHaveBeenCalled()
  })

  it('veto (Telegram): pending → vetoed', async () => {
    const res = await decideKairosProposal(USER, ID, { verdict: 'veto', via: 'telegram', now: NOW })
    expect(res).toMatchObject({ ok: true, verdict: 'veto' })
    expect(casVoiceSampleStatus).toHaveBeenCalledWith(USER, ID, 'pending', 'vetoed', NOW)
  })

  it('a lost compare-and-set reports already_decided and records nothing', async () => {
    vi.mocked(casVoiceSampleStatus).mockResolvedValue(false)
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'already_decided' })
    expect(recordProposalDecision).not.toHaveBeenCalled()
  })

  it('agents are refused before any effect', async () => {
    for (const via of ['mcp', 'rest-api-key'] as const) {
      const res = await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW, origin: { kind: 'agent', via } as never })
      expect(res).toMatchObject({ ok: false, reason: 'forbidden_actor' })
    }
    expect(casVoiceSampleStatus).not.toHaveBeenCalled()
  })

  it('past expiry: expired, no effect', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(sampleRow({ expiresAt: '2026-10-05T00:00:00.000Z' }))
    expect(await decideKairosProposal(USER, ID, { verdict: 'approve', via: 'inbox', now: NOW })).toMatchObject({ ok: false, reason: 'expired' })
    expect(casVoiceSampleStatus).not.toHaveBeenCalled()
  })

  it('the hourly sweep expires unanswered samples', async () => {
    vi.mocked(expireVoiceSamples).mockResolvedValue([ID])
    expect(await sweepExpiredProposals(USER, NOW)).toEqual({ expired: 1, telegramCleared: 0 })
    expect(expireVoiceSamples).toHaveBeenCalledWith(USER, NOW)
  })
})
