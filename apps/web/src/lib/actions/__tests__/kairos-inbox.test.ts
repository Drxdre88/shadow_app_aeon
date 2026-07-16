import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/data/inbox', () => ({
  getKairosInbox: vi.fn(),
  acceptInboxProposal: vi.fn(),
  dismissInboxMemory: vi.fn(),
}))

vi.mock('@/lib/kairos/ask', () => ({
  answerKairosAsk: vi.fn(),
}))

import { requireAuth } from '@/lib/actions/helpers'
import { acceptInboxProposal, dismissInboxMemory, getKairosInbox } from '@/lib/data/inbox'
import { answerKairosAsk } from '@/lib/kairos/ask'
import {
  acceptKairosInboxProposal,
  answerKairosInboxAsk,
  dismissKairosInboxProposal,
  listKairosInbox,
} from '../kairos-inbox'

const USER_ID = 'user-1'
const ASK_ID = '11111111-1111-4111-8111-111111111111'
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(USER_ID)
})

describe('Kairos inbox actions', () => {
  it('lists the current user inbox', async () => {
    const inbox = { items: [] }
    vi.mocked(getKairosInbox).mockResolvedValue(inbox)

    await expect(listKairosInbox()).resolves.toBe(inbox)
    expect(getKairosInbox).toHaveBeenCalledWith(USER_ID)
  })

  it('answers through the existing Ask orchestrator', async () => {
    vi.mocked(answerKairosAsk).mockResolvedValue({ reflectionId: 'reflection-1' })

    await expect(answerKairosInboxAsk(ASK_ID, '  The operator answer  ')).resolves.toEqual({
      reflectionId: 'reflection-1',
    })
    expect(answerKairosAsk).toHaveBeenCalledWith(USER_ID, ASK_ID, 'The operator answer')
  })

  it('rejects an empty Ask answer before calling the orchestrator', async () => {
    await expect(answerKairosInboxAsk(ASK_ID, '   ')).rejects.toThrow()
    expect(answerKairosAsk).not.toHaveBeenCalled()
  })

  it('surfaces a stale Ask as not found', async () => {
    vi.mocked(answerKairosAsk).mockResolvedValue({ error: 'not_found' })

    await expect(answerKairosInboxAsk(ASK_ID, 'Answer')).rejects.toThrow('Kairos question not found')
  })

  it('accepts through the shared inbox helper', async () => {
    vi.mocked(acceptInboxProposal).mockResolvedValue({ ok: true, id: PROPOSAL_ID })

    await expect(acceptKairosInboxProposal(PROPOSAL_ID)).resolves.toEqual({ id: PROPOSAL_ID })
    expect(acceptInboxProposal).toHaveBeenCalledWith(USER_ID, PROPOSAL_ID)
  })

  it('rejects a row that the proposal gate will not accept', async () => {
    vi.mocked(acceptInboxProposal).mockResolvedValue({ ok: false, reason: 'already_resolved' })

    await expect(acceptKairosInboxProposal(PROPOSAL_ID)).rejects.toThrow('Memory is not a pending proposal')
  })

  it('dismisses through the shared inbox helper', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: true, id: PROPOSAL_ID })

    await expect(dismissKairosInboxProposal(PROPOSAL_ID)).resolves.toEqual({ id: PROPOSAL_ID })
    expect(dismissInboxMemory).toHaveBeenCalledWith(USER_ID, PROPOSAL_ID)
  })

  it('surfaces a non-dismissable memory as not found', async () => {
    vi.mocked(dismissInboxMemory).mockResolvedValue({ ok: false, reason: 'not_found' })

    await expect(dismissKairosInboxProposal(PROPOSAL_ID)).rejects.toThrow('Proposal not found')
  })
})
