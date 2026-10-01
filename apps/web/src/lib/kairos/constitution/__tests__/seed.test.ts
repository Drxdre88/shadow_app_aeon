import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  findLiveConstitutionRow: vi.fn(),
  insertConstitutionProposal: vi.fn(),
  listPendingConstitutionProposals: vi.fn(),
  listSeedDominions: vi.fn(),
  listTopReflections: vi.fn(),
  getProviderForUser: vi.fn(),
}))
vi.mock('@/lib/data/constitution', () => ({
  findLiveConstitutionRow: m.findLiveConstitutionRow,
  insertConstitutionProposal: m.insertConstitutionProposal,
  listPendingConstitutionProposals: m.listPendingConstitutionProposals,
  listSeedDominions: m.listSeedDominions,
  listTopReflections: m.listTopReflections,
  // amendment.ts imports (unused by the seed path)
  acceptConstitutionProposalTx: vi.fn(),
  findLatestDriftRun: vi.fn(),
  listConstitutionVersionRows: vi.fn(),
}))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: m.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))

import { seedConstitutionDraft } from '../seed'

const USER = 'user-1'
const R = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const D = '33333333-3333-4333-8333-333333333333'

const draft = '```json\n' + JSON.stringify({
  principles: [
    { text: 'Tell the truth', reason: 'Trust compounds', citations: [R[0]] },
    { text: 'Protect rest', reason: 'Energy', citations: [R[1]] },
    { text: 'Serve the vision', reason: 'Focus', citations: [D] },
  ],
  rationale: 'Derived from reflections and the Swarm vision',
}) + '\n```'

beforeEach(() => {
  vi.clearAllMocks()
  m.findLiveConstitutionRow.mockResolvedValue(null)
  m.listPendingConstitutionProposals.mockResolvedValue([])
  m.listSeedDominions.mockResolvedValue([{ id: D, name: 'Swarm', vision: 'Calm trading', missionLong: null, objectives: [] }])
  m.listTopReflections.mockResolvedValue(R.map((id, i) => ({ id, title: `Reflection ${i}`, summary: null })))
  m.getProviderForUser.mockResolvedValue({ ask: vi.fn().mockResolvedValue({ text: draft }) })
  m.insertConstitutionProposal.mockResolvedValue({ written: true, memoryId: 'p1' })
})

describe('seedConstitutionDraft', () => {
  it('drafts on the heavy tier and writes ONE first-draft proposal (never the constitution)', async () => {
    expect(await seedConstitutionDraft(USER)).toEqual({ status: 'created', proposalId: 'p1', principles: 3 })
    expect(m.getProviderForUser).toHaveBeenCalledWith(USER, 'heavy')
    expect(m.listTopReflections).toHaveBeenCalledWith(USER, 20)
    const [, values, opts] = m.insertConstitutionProposal.mock.calls[0]
    expect(opts).toEqual({ firstDraftOnly: true })
    expect(values.sourceMetadata).toMatchObject({
      introspection: true,
      kind: 'constitution_amendment',
      status: 'pending',
      constitution: { basedOnVersion: 0, rationale: 'Derived from reflections and the Swarm vision' },
    })
    expect(values.sourceMetadata.constitution.principles.map((p: { n: number }) => p.n)).toEqual([1, 2, 3])
    // Only memory ids become provenance links (Dominion ids are not memories).
    expect(values.links.map((l: { target: string }) => l.target).sort()).toEqual([...R].sort())
  })

  it.each([
    ['a live constitution', () => m.findLiveConstitutionRow.mockResolvedValue({ id: 'c' }), 'constitution_exists'],
    ['a pending draft', () => m.listPendingConstitutionProposals.mockResolvedValue([{ id: 'p' }]), 'pending_draft_exists'],
  ])('skips without a model call when there is %s', async (_l, arrange, reason) => {
    arrange()
    expect(await seedConstitutionDraft(USER)).toEqual({ status: 'skipped', reason })
    expect(m.getProviderForUser).not.toHaveBeenCalled()
    expect(m.insertConstitutionProposal).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to ground a draft in', async () => {
    m.listSeedDominions.mockResolvedValue([{ id: D, name: 'Empty', vision: null, missionLong: '  ', objectives: [] }])
    m.listTopReflections.mockResolvedValue([])
    expect(await seedConstitutionDraft(USER)).toEqual({ status: 'skipped', reason: 'no_signal' })
    expect(m.getProviderForUser).not.toHaveBeenCalled()
  })

  it('reports the lock-time skip when a racing seed already wrote the draft', async () => {
    m.insertConstitutionProposal.mockResolvedValue({ written: false, memoryId: null, skipped: 'pending_draft_exists' })
    expect(await seedConstitutionDraft(USER)).toEqual({ status: 'skipped', reason: 'pending_draft_exists' })
  })

  it('errors (no write) when the draft stays ungrounded after repair', async () => {
    const bad = '```json\n' + JSON.stringify({ principles: [{ text: 'x', reason: 'y', citations: ['nope'] }], rationale: '' }) + '\n```'
    m.getProviderForUser.mockResolvedValue({ ask: vi.fn().mockResolvedValue({ text: bad }) })
    const res = await seedConstitutionDraft(USER)
    expect(res.status).toBe('error')
    expect(m.insertConstitutionProposal).not.toHaveBeenCalled()
  })
})
