import { beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({
  acceptConstitutionProposalTx: vi.fn(),
  findLatestDriftRun: vi.fn(),
  findLiveConstitutionRow: vi.fn(),
  insertConstitutionProposal: vi.fn(),
  listConstitutionVersionRows: vi.fn(),
  listPendingConstitutionProposals: vi.fn(),
}))
vi.mock('@/lib/data/constitution', () => data)

import {
  applyAcceptedConstitutionAmendment,
  buildProposalValues,
  constitutionPatchRefusal,
  decideConstitutionAcceptance,
  getConstitutionOverview,
  getLatestDriftStatus,
  isConstitutionRow,
  OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR,
  proposeConstitutionAmendment,
  type ConstitutionPatch,
} from '../amendment'

const USER = 'user-1'
const PROPOSAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LIVE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = new Date('2026-10-01T08:00:00Z')

const principles = [
  { n: 7, text: 'Tell the truth', reason: 'Trust compounds' },
  { n: 9, text: 'Protect rest', reason: 'Energy is the bottleneck' },
]

function proposal(over: Record<string, unknown> = {}, basedOnVersion = 0) {
  return {
    id: PROPOSAL,
    type: 'inbound',
    sourceMetadata: {
      introspection: true,
      kind: 'constitution_amendment',
      status: 'pending',
      citations: ['r1'],
      constitution: { principles, basedOnVersion, rationale: 'because' },
      ...over,
    },
  }
}

function liveRow(version: number) {
  return {
    id: LIVE,
    title: `Constitution v${version}`,
    bodyMd: '',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    supersededAt: null,
    sourceMetadata: { constitution: { version, principles: [{ n: 1, text: 'Old', reason: 'Old reason' }], acceptedFrom: 'p0' } },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  data.findLiveConstitutionRow.mockResolvedValue(null)
  data.insertConstitutionProposal.mockResolvedValue({ written: true, memoryId: 'new-proposal' })
})

describe('constitution row guard (agent surfaces)', () => {
  const constitution = {
    type: 'constitution',
    streamClass: 'constitution',
    title: 'Constitution v2',
    bodyMd: '# Constitution v2',
    summary: 'Constitution v2: 2 principles',
    supersededAt: null,
  }
  const superseded = { ...constitution, title: 'Constitution v1', supersededAt: new Date('2026-09-01') }
  const note = { type: 'note', streamClass: 'operator_capture', title: 'n', bodyMd: 'b', summary: null }
  const ARCHIVE = '2026-10-02T00:00:00.000Z'

  it.each([
    ['archive', constitution, { archivedAt: ARCHIVE }, true],
    ['unarchive (archivedAt:null)', constitution, { archivedAt: null }, false],
    ['type change', constitution, { type: 'note' }, true],
    ['same type', constitution, { type: 'constitution' }, false],
    ['title change', constitution, { title: 'Hijacked' }, true],
    ['bodyMd change', constitution, { bodyMd: 'rewritten' }, true],
    ['summary change', constitution, { summary: null }, true],
    ['unchanged title', constitution, { title: 'Constitution v2' }, false],
    ['aiTitle backfill', constitution, { aiTitle: 'Core principles' }, false],
    ['execSummary/tags/pinned', constitution, { execSummary: ['a'], tags: ['constitution'], pinned: true }, false],
    ['non-constitution archive', note, { archivedAt: ARCHIVE }, false],
    ['non-constitution retype', note, { type: 'idea', title: 'x' }, false],
    ['superseded constitution archive', superseded, { archivedAt: ARCHIVE }, true],
    ['superseded constitution rewrite', superseded, { bodyMd: 'x' }, true],
  ] as const)('%s', (_label, row, patch, refused) => {
    expect(constitutionPatchRefusal(row, patch as ConstitutionPatch)).toBe(
      refused ? OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR : null,
    )
  })

  it('treats a missing row as allowed (the data layer returns not found)', () => {
    expect(constitutionPatchRefusal(null, { archivedAt: ARCHIVE })).toBeNull()
  })

  it('recognises constitution rows by type or stream class', () => {
    expect(isConstitutionRow({ type: 'constitution', streamClass: null })).toBe(true)
    expect(isConstitutionRow({ type: 'note', streamClass: 'constitution' })).toBe(true)
    expect(isConstitutionRow({ type: 'inbound', streamClass: 'introspection' })).toBe(false)
    expect(isConstitutionRow(null)).toBe(false)
  })
})

describe('buildProposalValues', () => {
  it('writes an inbound introspection proposal with numbered, reasoned principles', () => {
    const v = buildProposalValues({
      principles: [{ text: ' Tell the truth ', reason: 'Trust compounds' }, { text: 'Rest', reason: 'Energy' }],
      rationale: 'Seeded',
      basedOnVersion: 0,
      source: 'cron',
      citations: ['r1', 'r1', 'r2'],
      runId: 'constitution-seed:2026-10-01',
    })
    expect(v.title).toBe('Constitution draft v1')
    expect(v.sourceMetadata).toEqual({
      introspection: true,
      kind: 'constitution_amendment',
      status: 'pending',
      constitution: {
        principles: [
          { n: 1, text: 'Tell the truth', reason: 'Trust compounds' },
          { n: 2, text: 'Rest', reason: 'Energy' },
        ],
        basedOnVersion: 0,
        rationale: 'Seeded',
      },
      citations: ['r1', 'r2'],
      runId: 'constitution-seed:2026-10-01',
    })
    expect(v.links).toEqual([
      { type: 'refers_to', target: 'r1', target_kind: 'memory' },
      { type: 'refers_to', target: 'r2', target_kind: 'memory' },
    ])
    expect(v.tags).toEqual(['proposal', 'constitution'])
    expect(v.bodyMd).toContain('1. **Tell the truth**')
    expect(v.bodyMd).toContain('_Because:_ Trust compounds')
  })
})

describe('proposeConstitutionAmendment', () => {
  it('bases the proposal on the live version and never writes a constitution', async () => {
    data.findLiveConstitutionRow.mockResolvedValue(liveRow(3))
    const res = await proposeConstitutionAmendment(USER, { principles: [{ text: 'A', reason: 'B' }], rationale: 'R' }, 'claude')
    expect(res).toEqual({ ok: true, proposalId: 'new-proposal', basedOnVersion: 3, principles: 1 })
    const [, values, opts] = data.insertConstitutionProposal.mock.calls[0]
    expect(values.title).toBe('Constitution amendment v3 → v4')
    expect(values.source).toBe('claude')
    expect(values.sourceMetadata.constitution.basedOnVersion).toBe(3)
    expect(opts).toBeUndefined()
    expect(data.acceptConstitutionProposalTx).not.toHaveBeenCalled()
  })

  it('is a first draft (basedOnVersion 0) when no constitution exists', async () => {
    const res = await proposeConstitutionAmendment(USER, { principles: [{ text: 'A', reason: 'B' }], rationale: 'R' }, 'manual')
    expect(res.basedOnVersion).toBe(0)
  })
})

describe('decideConstitutionAcceptance', () => {
  it('builds v1 from a first draft, renumbering principles', () => {
    const d = decideConstitutionAcceptance(proposal(), null, NOW)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.values.version).toBe(1)
    expect(d.values.title).toBe('Constitution v1')
    expect(d.values.sourceMetadata.constitution).toEqual({
      version: 1,
      principles: [
        { n: 1, text: 'Tell the truth', reason: 'Trust compounds' },
        { n: 2, text: 'Protect rest', reason: 'Energy is the bottleneck' },
      ],
      acceptedFrom: PROPOSAL,
    })
    expect(d.values.links).toEqual([
      { type: 'refers_to', target: PROPOSAL, target_kind: 'memory' },
      { type: 'refers_to', target: 'r1', target_kind: 'memory' },
    ])
    expect(d.values.opAfter).toMatchObject({ version: 1, acceptedFrom: PROPOSAL, previousVersion: null })
  })

  it('builds v(n+1) on top of the live version and links the superseded one', () => {
    const d = decideConstitutionAcceptance(proposal({}, 2), liveRow(2), NOW)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.values.version).toBe(3)
    expect(d.values.links).toContainEqual({ type: 'supersedes', target: LIVE, target_kind: 'memory' })
    expect(d.values.opReason).toContain('v2 → v3')
  })

  it.each([
    ['a non-proposal', { ...proposal(), type: 'observation' }, null, 'not_a_constitution_amendment'],
    ['another proposal kind', proposal({ kind: 'reflection' }), null, 'not_a_constitution_amendment'],
    ['an already-dismissed proposal', proposal({ status: 'dismissed' }), null, 'not_pending'],
    ['a malformed amendment', proposal({ constitution: { principles: [] } }), null, 'invalid_amendment'],
    ['a stale amendment', proposal({}, 1), liveRow(2), 'stale_amendment'],
    ['a draft when a constitution already exists', proposal({}, 0), liveRow(1), 'stale_amendment'],
  ])('refuses %s', (_label, p, live, reason) => {
    expect(decideConstitutionAcceptance(p, live, NOW)).toEqual({ ok: false, reason })
  })
})

describe('applyAcceptedConstitutionAmendment', () => {
  it('runs the acceptance transaction with the pure decision', async () => {
    data.acceptConstitutionProposalTx.mockImplementation(async (_u: string, _p: string, decide: typeof decideConstitutionAcceptance) => {
      const d = decide(proposal(), null)
      return d.ok ? { ok: true, constitutionId: 'c1', version: d.values.version, supersededId: null, alreadyApplied: false } : d
    })
    const res = await applyAcceptedConstitutionAmendment(USER, PROPOSAL, NOW)
    expect(res).toEqual({ ok: true, constitutionId: 'c1', version: 1, supersededId: null, alreadyApplied: false })
    expect(data.acceptConstitutionProposalTx).toHaveBeenCalledWith(USER, PROPOSAL, expect.any(Function), NOW)
  })

  it('treats a non-uuid id as not found without touching the DB', async () => {
    expect(await applyAcceptedConstitutionAmendment(USER, 'nope')).toEqual({ ok: false, reason: 'not_found' })
    expect(data.acceptConstitutionProposalTx).not.toHaveBeenCalled()
  })
})

describe('getLatestDriftStatus', () => {
  it('returns null before any drift run exists', async () => {
    data.findLatestDriftRun.mockResolvedValue(null)
    expect(await getLatestDriftStatus(USER)).toBeNull()
  })

  it('reads mean, alert and flipped probes (with their questions)', async () => {
    const createdAt = new Date('2026-10-01T04:00:00Z')
    data.findLatestDriftRun.mockResolvedValue({
      id: 'd1',
      createdAt,
      sourceMetadata: {
        kind: 'drift_run',
        drift: {
          date: '2026-10-01',
          version: 2,
          mean: 0.71,
          alert: true,
          flipped: ['nature-01'],
          perProbe: [{ probeId: 'nature-01', sim: 0.4 }, { probeId: 'values-01', sim: 0.9 }],
        },
      },
    })
    expect(await getLatestDriftStatus(USER)).toEqual({
      date: '2026-10-01',
      version: 2,
      mean: 0.71,
      alert: true,
      flipped: [{ probeId: 'nature-01', question: 'What is Kairos?', sim: 0.4 }],
      measuredAt: createdAt,
    })
  })
})

describe('getConstitutionOverview', () => {
  it('combines the live version, history, pending amendments and drift', async () => {
    data.findLiveConstitutionRow.mockResolvedValue(liveRow(2))
    data.listConstitutionVersionRows.mockResolvedValue([liveRow(2), { ...liveRow(1), id: 'old', supersededAt: NOW }])
    data.listPendingConstitutionProposals.mockResolvedValue([
      { id: PROPOSAL, title: 'Constitution amendment v2 → v3', bodyMd: '', createdAt: NOW, supersededAt: null, sourceMetadata: proposal({}, 2).sourceMetadata },
    ])
    data.findLatestDriftRun.mockResolvedValue(null)
    const o = await getConstitutionOverview(USER)
    expect(o.constitution).toMatchObject({ id: LIVE, version: 2 })
    expect(o.versions.map((v) => v.version)).toEqual([2, 1])
    expect(o.pendingAmendments).toEqual([
      { id: PROPOSAL, title: 'Constitution amendment v2 → v3', basedOnVersion: 2, principles: 2, createdAt: NOW },
    ])
    expect(o.drift).toBeNull()
  })
})
