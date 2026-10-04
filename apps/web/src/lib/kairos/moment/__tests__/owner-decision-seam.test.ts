import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Inbox triage × moment seam: the owner-decision hook runs once after a
// successful accept/dismiss and never on a failed one; empty lanes change nothing.

const lanes = vi.hoisted(() => ({ rapport: {} as Record<string, unknown> }))
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: lanes.rapport }))
vi.mock('@/lib/data/memories', () => ({ findMemoryById: vi.fn(), archiveMemory: vi.fn(), acceptProposal: vi.fn(), markKairosSpeaksReplied: vi.fn() }))
vi.mock('../../constitution/amendment', () => ({ applyAcceptedConstitutionAmendment: vi.fn() }))
vi.mock('../../reactions', () => ({ reactOutcome: vi.fn(async () => undefined), reactUsed: vi.fn(async () => undefined) }))
vi.mock('@/lib/data/ideas', () => ({ recordIdeaOutcome: vi.fn(async () => true) }))
vi.mock('../../proposal-decision', () => ({ decideKairosProposal: vi.fn(), isDecidableProposalKind: (kind: unknown) => kind === 'goal' }))
vi.mock('../../today', () => ({ recordToday: vi.fn(async () => undefined) }))

import { acceptProposal, archiveMemory, findMemoryById, markKairosSpeaksReplied } from '@/lib/data/memories'
import { decideKairosProposal } from '../../proposal-decision'
import { acceptInboxProposal, dismissInboxMemory } from '../../proposal-accept'

const speak = { id: 'm1', type: 'inbound', title: 'Heads up', archivedAt: null, sourceMetadata: { kairosSpeak: true, status: 'pending', kind: 'notify' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findMemoryById).mockResolvedValue(speak as never)
  vi.mocked(archiveMemory).mockResolvedValue({ id: 'm1' } as never)
})

afterEach(() => {
  for (const key of Object.keys(lanes.rapport)) delete lanes.rapport[key]
})

describe('owner decision hooks', () => {
  it('empty lanes: dismiss resolves exactly as before', async () => {
    expect(await dismissInboxMemory('u', 'm1')).toEqual({ ok: true, id: 'm1' })
    expect(markKairosSpeaksReplied).toHaveBeenCalledOnce()
  })

  it('a dismissed speak reaches the lane with kairosSpeak and kind', async () => {
    const hook = vi.fn()
    lanes.rapport.ownerDecision = hook
    await dismissInboxMemory('u', 'm1')
    expect(hook).toHaveBeenCalledOnce()
    expect(hook).toHaveBeenCalledWith({ userId: 'u', memoryId: 'm1', verdict: 'dismiss', kairosSpeak: true, kind: 'notify' })
  })

  it('an already-resolved dismiss or a failed goal veto never reaches the lane', async () => {
    const hook = vi.fn()
    lanes.rapport.ownerDecision = hook
    vi.mocked(findMemoryById).mockResolvedValue({ ...speak, sourceMetadata: { kairosSpeak: true, status: 'replied' } } as never)
    expect(await dismissInboxMemory('u', 'm1')).toEqual({ ok: false, reason: 'already_resolved' })
    vi.mocked(findMemoryById).mockResolvedValue({ ...speak, sourceMetadata: { kind: 'goal' } } as never)
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: false, reason: 'already_decided' } as never)
    await dismissInboxMemory('u', 'm1')
    expect(hook).not.toHaveBeenCalled()
  })

  it('a successful accept reaches the lane; a throwing hook never fails the accept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    lanes.rapport.ownerDecision = vi.fn(() => { throw new Error('boom') })
    vi.mocked(findMemoryById).mockResolvedValue({ ...speak, sourceMetadata: { kind: 'insight', status: 'pending' } } as never)
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: { id: 'm1' } } as never)
    expect(await acceptInboxProposal('u', 'm1')).toEqual({ ok: true, id: 'm1' })
    expect(lanes.rapport.ownerDecision).toHaveBeenCalledWith({ userId: 'u', memoryId: 'm1', verdict: 'accept', kairosSpeak: false, kind: 'insight' })
  })
})
