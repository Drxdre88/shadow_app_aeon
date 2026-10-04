import { beforeEach, describe, expect, it, vi } from 'vitest'

// One mind (spec_one_mind): owner decisions land in the today log exactly
// once. Owner-decided kinds (goals) are recorded by decideKairosProposal after
// its claim-once transition wins; the inbox accept / dismiss paths record the
// non-decidable kinds only, so a goal tapped in the inbox is never logged twice.

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
vi.mock('../goals/transitions', () => ({ approveGoal: vi.fn(), vetoGoal: vi.fn(), expireStaleGoals: vi.fn() }))
vi.mock('../promises/create', () => ({ createKairosPromises: vi.fn() }))
vi.mock('../agenda/goal-checkins', () => ({ bookGoalCheckins: vi.fn(async () => undefined) }))
vi.mock('../reactions', () => ({ reactOutcome: vi.fn(async () => undefined), reactUsed: vi.fn(async () => undefined) }))
vi.mock('../today', () => ({ recordToday: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/memories', () => ({
  findMemoryById: vi.fn(),
  archiveMemory: vi.fn(),
  acceptProposal: vi.fn(),
  markKairosSpeaksReplied: vi.fn(),
}))
vi.mock('../constitution/amendment', () => ({ applyAcceptedConstitutionAmendment: vi.fn() }))
vi.mock('@/lib/data/ideas', () => ({ recordIdeaOutcome: vi.fn(async () => true) }))

import { findProposalForDecision } from '@/lib/data/proposal-decision'
import { acceptProposal, archiveMemory, findMemoryById } from '@/lib/data/memories'
import { approveGoal } from '../goals/transitions'
import { recordToday } from '../today'
import { decideKairosProposal } from '../proposal-decision'
import { acceptKairosProposal, dismissInboxMemory } from '../proposal-accept'

const USER = 'user-1'
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = new Date('2026-10-02T09:00:00.000Z')

const goalRow = (extra: Record<string, unknown> = {}) => ({
  id: GOAL_ID,
  title: 'Why do Monday boards drift?',
  type: 'inbound',
  archivedAt: null,
  sourceMetadata: { kind: 'goal', status: 'pending', expiresAt: '2026-10-04T09:00:00.000Z', goal: { state: 'proposed' }, ...extra },
})

const approved = { id: GOAL_ID, title: 'Why do Monday boards drift?', meta: { question: 'q', dueAt: null } }

type Found = Awaited<ReturnType<typeof findMemoryById>>
const memory = (over: Record<string, unknown> = {}) =>
  ({ id: PROPOSAL_ID, title: 'Ship smaller batches', type: 'inbound', archivedAt: null, sourceMetadata: { introspection: true, status: 'pending' }, ...over }) as unknown as Found

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TELEGRAM_BOT_TOKEN
})

describe('goal decisions — recorded once, by the decision function', () => {
  it('a Telegram approve logs one operator/telegram "decided" entry', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(goalRow() as never)
    vi.mocked(approveGoal).mockResolvedValue({ ok: true, goal: approved as never })

    const res = await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'telegram', now: NOW })

    expect(res).toMatchObject({ ok: true })
    expect(recordToday).toHaveBeenCalledOnce()
    expect(recordToday).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ key: `decision:${GOAL_ID}`, channel: 'telegram', type: 'decided', text: 'Approved: Why do Monday boards drift?' }),
      { kind: 'operator', via: 'telegram' },
    )
  })

  it('a lost claim (already decided) or a refused agent records nothing', async () => {
    vi.mocked(findProposalForDecision).mockResolvedValue(goalRow() as never)
    vi.mocked(approveGoal).mockResolvedValue({ ok: false, reason: 'already_resolved' })
    await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW })
    await decideKairosProposal(USER, GOAL_ID, { verdict: 'approve', via: 'inbox', now: NOW, origin: { kind: 'agent', via: 'mcp' } })

    expect(recordToday).not.toHaveBeenCalled()
  })

  it('an inbox accept of a goal is logged once (by the decision), never again by the accept path', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(memory({ id: GOAL_ID, sourceMetadata: { kind: 'goal', status: 'pending' } }))
    // This path reads the real clock, so the proposal must not have expired yet.
    vi.mocked(findProposalForDecision).mockResolvedValue(goalRow({ expiresAt: '2999-01-01T00:00:00.000Z' }) as never)
    vi.mocked(approveGoal).mockResolvedValue({ ok: true, goal: approved as never })

    await acceptKairosProposal(GOAL_ID, USER, { pin: false })

    expect(recordToday).toHaveBeenCalledOnce()
    expect(vi.mocked(recordToday).mock.calls[0][1]).toMatchObject({ key: `decision:${GOAL_ID}`, channel: 'inbox' })
  })
})

describe('inbox accept / dismiss — non-decidable kinds', () => {
  it('logs an accept with the caller origin passed through (agent over MCP → agent speaker)', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(memory())
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: memory() as never })

    await acceptKairosProposal(PROPOSAL_ID, USER, { pin: false }, { origin: { kind: 'agent', via: 'mcp' } })

    expect(recordToday).toHaveBeenCalledOnce()
    expect(recordToday).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ key: `inbox:${PROPOSAL_ID}`, channel: 'mcp', type: 'decided', text: 'Accepted: Ship smaller batches' }),
      { kind: 'agent', via: 'mcp' },
    )
    // The opt-out flag never reaches the data layer.
    expect(acceptProposal).toHaveBeenCalledWith(PROPOSAL_ID, USER, { pin: false }, { origin: { kind: 'agent', via: 'mcp' } })
  })

  it('defaults to operator/accept, and logs nothing with recordToday:false or a failed accept', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(memory())
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: memory() as never })
    await acceptKairosProposal(PROPOSAL_ID, USER, { pin: false })
    expect(vi.mocked(recordToday).mock.calls[0][2]).toEqual({ kind: 'operator', via: 'accept' })

    vi.mocked(recordToday).mockClear()
    await acceptKairosProposal(PROPOSAL_ID, USER, { pin: false }, { recordToday: false })
    vi.mocked(acceptProposal).mockResolvedValueOnce({ ok: false, reason: 'not_a_proposal' })
    await acceptKairosProposal(PROPOSAL_ID, USER, { pin: false })
    expect(recordToday).not.toHaveBeenCalled()
  })

  it('logs a dismiss as an operator/inbox decision', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(memory())
    vi.mocked(archiveMemory).mockResolvedValue(memory({ archivedAt: new Date() }) as never)

    await dismissInboxMemory(USER, PROPOSAL_ID)

    expect(recordToday).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ key: `inbox:${PROPOSAL_ID}`, channel: 'inbox', type: 'decided', text: 'Dismissed: Ship smaller batches' }),
      { kind: 'operator', via: 'inbox' },
    )
  })
})
