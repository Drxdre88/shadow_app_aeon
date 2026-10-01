import { beforeEach, describe, expect, it, vi } from 'vitest'

// Proposal triage in the kairos layer (docs/kairos/32 §2, docs/kairos/34 §2):
// constitution amendments are accepted by writing a new constitution version
// and NEVER by the generic promote; every other accept goes through the data
// layer and then gets its operator reactions; dismiss vetoes a proposal.

vi.mock('@/lib/data/memories', () => ({
  findMemoryById: vi.fn(),
  archiveMemory: vi.fn(),
  acceptProposal: vi.fn(),
  markKairosSpeaksReplied: vi.fn(),
}))

vi.mock('../constitution/amendment', () => ({
  applyAcceptedConstitutionAmendment: vi.fn(),
}))

vi.mock('../reactions', () => ({
  reactOutcome: vi.fn(async () => undefined),
  reactUsed: vi.fn(async () => undefined),
}))

import { acceptProposal, archiveMemory, findMemoryById, markKairosSpeaksReplied } from '@/lib/data/memories'
import { applyAcceptedConstitutionAmendment } from '../constitution/amendment'
import { reactOutcome, reactUsed } from '../reactions'
import { acceptInboxProposal, acceptKairosProposal, dismissInboxMemory } from '../proposal-accept'

type FoundMemory = Awaited<ReturnType<typeof findMemoryById>>

const USER_ID = 'user-1'
const PROPOSAL_ID = 'a1111111-1111-4111-8111-111111111111'
const CONSTITUTION_ID = 'c2222222-2222-4222-8222-222222222222'

function foundMemory(overrides: Partial<Record<string, unknown>> = {}): FoundMemory {
  return {
    id: 'mem-1',
    type: 'inbound',
    archivedAt: null,
    sourceMetadata: { kairosSpeak: true, status: 'pending' },
    ...overrides,
  } as unknown as FoundMemory
}

function amendmentProposal(): FoundMemory {
  return foundMemory({
    id: PROPOSAL_ID,
    sourceMetadata: { introspection: true, kind: 'constitution_amendment', status: 'pending' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('acceptKairosProposal — constitution amendment', () => {
  it('writes the new version and returns the constitution row; never runs the generic promote or reactions', async () => {
    const constitutionRow = foundMemory({ id: CONSTITUTION_ID, type: 'constitution' })
    vi.mocked(findMemoryById)
      .mockResolvedValueOnce(amendmentProposal())
      .mockResolvedValueOnce(constitutionRow)
    vi.mocked(applyAcceptedConstitutionAmendment).mockResolvedValue({
      ok: true,
      constitutionId: CONSTITUTION_ID,
    } as never)

    const result = await acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false })

    expect(result).toEqual({ ok: true, memory: constitutionRow })
    expect(applyAcceptedConstitutionAmendment).toHaveBeenCalledWith(USER_ID, PROPOSAL_ID)
    expect(findMemoryById).toHaveBeenLastCalledWith(CONSTITUTION_ID, USER_ID)
    expect(acceptProposal).not.toHaveBeenCalled()
    expect(reactOutcome).not.toHaveBeenCalled()
    expect(reactUsed).not.toHaveBeenCalled()
  })

  it('maps a stale amendment to stale_amendment', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce(amendmentProposal())
    vi.mocked(applyAcceptedConstitutionAmendment).mockResolvedValue({ ok: false, reason: 'stale_amendment' } as never)

    await expect(acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false }))
      .resolves.toEqual({ ok: false, reason: 'stale_amendment' })
    expect(acceptProposal).not.toHaveBeenCalled()
  })

  it('maps not_found from the amendment path to null', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce(amendmentProposal())
    vi.mocked(applyAcceptedConstitutionAmendment).mockResolvedValue({ ok: false, reason: 'not_found' } as never)

    await expect(acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false })).resolves.toBeNull()
    expect(acceptProposal).not.toHaveBeenCalled()
  })

  it('maps any other amendment failure (e.g. already resolved) to not_a_proposal', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce(amendmentProposal())
    vi.mocked(applyAcceptedConstitutionAmendment).mockResolvedValue({ ok: false, reason: 'not_pending' } as never)

    await expect(acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false }))
      .resolves.toEqual({ ok: false, reason: 'not_a_proposal' })
  })

  it('returns null for a missing proposal without touching either path', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce(null as unknown as FoundMemory)

    await expect(acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false })).resolves.toBeNull()
    expect(applyAcceptedConstitutionAmendment).not.toHaveBeenCalled()
    expect(acceptProposal).not.toHaveBeenCalled()
  })
})

describe('acceptKairosProposal — other proposals', () => {
  it('delegates to the data-layer accept, then reacts (Outcome positive + Usage) on success', async () => {
    const promoted = foundMemory({ id: PROPOSAL_ID, type: 'belief' })
    vi.mocked(findMemoryById).mockResolvedValueOnce(
      foundMemory({ id: PROPOSAL_ID, sourceMetadata: { introspection: true, kind: 'reflection', status: 'pending' } }),
    )
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: promoted as never })

    await expect(acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: true }))
      .resolves.toEqual({ ok: true, memory: promoted })

    expect(acceptProposal).toHaveBeenCalledWith(PROPOSAL_ID, USER_ID, { pin: true }, {})
    expect(applyAcceptedConstitutionAmendment).not.toHaveBeenCalled()
    expect(reactOutcome).toHaveBeenCalledWith(USER_ID, PROPOSAL_ID, 'positive', expect.any(String))
    expect(reactUsed).toHaveBeenCalledWith(USER_ID, [PROPOSAL_ID], expect.any(String))
    // Reactions run only after the accept committed.
    expect(vi.mocked(reactOutcome).mock.invocationCallOrder[0])
      .toBeGreaterThan(vi.mocked(acceptProposal).mock.invocationCallOrder[0])
  })

  it('does not react when the accept failed or found nothing', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ sourceMetadata: { contradictionCheck: true } }))
    vi.mocked(acceptProposal).mockResolvedValueOnce({ ok: false, reason: 'loser_already_superseded' })
    await acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false })
    vi.mocked(acceptProposal).mockResolvedValueOnce(null)
    await acceptKairosProposal(PROPOSAL_ID, USER_ID, { pin: false })

    expect(reactOutcome).not.toHaveBeenCalled()
    expect(reactUsed).not.toHaveBeenCalled()
  })
})

describe('dismissInboxMemory', () => {
  it('archives a pending inbound memory', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory())
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    const result = await dismissInboxMemory(USER_ID, 'mem-1')
    expect(result).toEqual({ ok: true, id: 'mem-1' })
    expect(archiveMemory).toHaveBeenCalledWith('mem-1', USER_ID)
  })

  it('marks pending Kairos speaks replied when a speak is dismissed (clears the reply gate)', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory())
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    await dismissInboxMemory(USER_ID, 'mem-1')
    expect(markKairosSpeaksReplied).toHaveBeenCalledWith(USER_ID, expect.any(Date))
  })

  it('does not mark speaks when dismissing a non-speak proposal', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ sourceMetadata: { introspection: true, status: 'pending' } }))
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    await expect(dismissInboxMemory(USER_ID, 'mem-1')).resolves.toEqual({ ok: true, id: 'mem-1' })
    expect(markKairosSpeaksReplied).not.toHaveBeenCalled()
  })

  it('records Outcome negative (feedback) when a proposal is dismissed', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ sourceMetadata: { introspection: true, status: 'pending' } }))
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    await dismissInboxMemory(USER_ID, 'mem-1')
    expect(reactOutcome).toHaveBeenCalledWith(USER_ID, 'mem-1', 'negative', expect.any(String))
  })

  it('dismissing a Kairos speak records no outcome (unchanged speak path)', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory())
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    await dismissInboxMemory(USER_ID, 'mem-1')
    expect(reactOutcome).not.toHaveBeenCalled()
  })

  it('still dismisses when the reply marker fails', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory())
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))
    vi.mocked(markKairosSpeaksReplied).mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(dismissInboxMemory(USER_ID, 'mem-1')).resolves.toEqual({ ok: true, id: 'mem-1' })
    errorSpy.mockRestore()
  })

  it('is idempotent: an already-archived memory reports already_resolved', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    const result = await dismissInboxMemory(USER_ID, 'mem-1')
    expect(result).toEqual({ ok: false, reason: 'already_resolved' })
    expect(archiveMemory).not.toHaveBeenCalled()
    expect(reactOutcome).not.toHaveBeenCalled()
  })

  it('rejects non-inbound or missing memories as not_found', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(null as unknown as FoundMemory)
    await expect(dismissInboxMemory(USER_ID, 'mem-x')).resolves.toEqual({ ok: false, reason: 'not_found' })

    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ type: 'note' }))
    await expect(dismissInboxMemory(USER_ID, 'mem-1')).resolves.toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('acceptInboxProposal', () => {
  beforeEach(() => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ sourceMetadata: { introspection: true, status: 'pending' } }))
  })

  it('promotes via the shared accept', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: foundMemory() as never })
    const result = await acceptInboxProposal(USER_ID, 'mem-1')
    expect(result).toEqual({ ok: true, id: 'mem-1' })
    // No origin passed → the data layer records the operator's endorsement.
    expect(acceptProposal).toHaveBeenCalledWith('mem-1', USER_ID, { pin: false }, {})
  })

  it('forwards a bearer surface origin so an AI-client accept is not the operator', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: foundMemory() as never })
    await acceptKairosProposal('mem-1', USER_ID, { pin: false }, { origin: { kind: 'agent', via: 'mcp' } })
    expect(acceptProposal).toHaveBeenCalledWith('mem-1', USER_ID, { pin: false }, { origin: { kind: 'agent', via: 'mcp' } })
  })

  it('accepts a constitution amendment through the constitution path (Telegram/inbox parity)', async () => {
    vi.mocked(findMemoryById)
      .mockResolvedValueOnce(amendmentProposal())
      .mockResolvedValueOnce(foundMemory({ id: CONSTITUTION_ID, type: 'constitution' }))
    vi.mocked(applyAcceptedConstitutionAmendment).mockResolvedValue({ ok: true, constitutionId: CONSTITUTION_ID } as never)

    await expect(acceptInboxProposal(USER_ID, PROPOSAL_ID)).resolves.toEqual({ ok: true, id: CONSTITUTION_ID })
    expect(acceptProposal).not.toHaveBeenCalled()
  })

  it('maps a non-pending proposal to already_resolved', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({ ok: false, reason: 'not_a_proposal' })
    await expect(acceptInboxProposal(USER_ID, 'mem-1')).resolves.toEqual({ ok: false, reason: 'already_resolved' })
  })

  it('maps a missing memory to not_found', async () => {
    vi.mocked(acceptProposal).mockResolvedValue(null)
    await expect(acceptInboxProposal(USER_ID, 'mem-1')).resolves.toEqual({ ok: false, reason: 'not_found' })
  })
})
