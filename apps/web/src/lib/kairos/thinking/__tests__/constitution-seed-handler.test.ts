import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

const m = vi.hoisted(() => ({
  findLiveConstitutionRow: vi.fn(),
  insertConstitutionProposal: vi.fn(),
  listPendingConstitutionProposals: vi.fn(),
  listSeedDominions: vi.fn(),
  listTopReflections: vi.fn(),
  hasJobWithKeyLike: vi.fn(),
  isJobDone: vi.fn(),
  getProviderForUser: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/constitution', () => ({
  findLiveConstitutionRow: m.findLiveConstitutionRow,
  insertConstitutionProposal: m.insertConstitutionProposal,
  listPendingConstitutionProposals: m.listPendingConstitutionProposals,
  listSeedDominions: m.listSeedDominions,
  listTopReflections: m.listTopReflections,
  acceptConstitutionProposalTx: vi.fn(),
  findLatestDriftRun: vi.fn(),
  listConstitutionVersionRows: vi.fn(),
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike, isJobDone: m.isJobDone }))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: m.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: m.writeCronSuccessTrace, writeCronFailureTrace: vi.fn() }))

import { CONSTITUTION_DRAFT_SYSTEM_PROMPT, DRAFT_MAX_OUTPUT_TOKENS } from '@/lib/kairos/constitution/prompts'
import { constitutionSeedHandler } from '../handlers/constitution-seed'

const USER = 'user-1'
const R = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const D = '33333333-3333-4333-8333-333333333333'
// Monday 2026-10-05 is ISO week 2026-W41.
const MONDAY = '2026-10-05'
const at = (hhmm: string, day = MONDAY) => new Date(`${day}T${hhmm}:00.000Z`)
const KEY = 'constitution_seed:2026-W41'

const draft = (citations: string[][] = [[R[0]], [R[1]], [D]]) => '```json\n' + JSON.stringify({
  principles: citations.map((c, i) => ({ text: `Principle ${i}`, reason: `Reason ${i}`, citations: c })),
  rationale: 'From reflections and the Swarm vision',
}) + '\n```'

function jobRow(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    userId: USER,
    kind: 'constitution_seed',
    dominionId: null,
    externalKey: KEY,
    status: 'claimed',
    input: {
      system: CONSTITUTION_DRAFT_SYSTEM_PROMPT,
      prompt: 'p',
      validMemoryIds: [D, ...R],
      context: { week: '2026-W41', reflectionIds: R },
    },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('04:41'),
    deadlineAt: at('05:56'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('04:40'),
    updatedAt: at('04:40'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.findLiveConstitutionRow.mockResolvedValue(null)
  m.listPendingConstitutionProposals.mockResolvedValue([])
  m.listSeedDominions.mockResolvedValue([{ id: D, name: 'Swarm', vision: 'Calm trading', missionLong: null, objectives: [] }])
  m.listTopReflections.mockResolvedValue(R.map((id, i) => ({ id, title: `Reflection ${i}`, summary: null })))
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.insertConstitutionProposal.mockResolvedValue({ written: true, memoryId: 'p1' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('constitution_seed plan', () => {
  it('plans one user-wide job on Monday with the seed cron\'s exact prompt, due before the 05:58 fallback', async () => {
    const specs = await constitutionSeedHandler.plan(USER, at('04:40'))
    expect(specs).toHaveLength(1)
    const [spec] = specs
    expect(spec).toMatchObject({ kind: 'constitution_seed', dominionId: null, externalKey: KEY, deadlineMinutes: 76 })
    expect(spec.input.system).toBe(CONSTITUTION_DRAFT_SYSTEM_PROMPT)
    expect(spec.input.prompt).toContain(`[${D}] Swarm`)
    expect(spec.input.prompt).toContain(`[${R[0]}] Reflection 0`)
    expect(spec.input.validMemoryIds).toEqual([D, ...R])
    expect(spec.input.maxOutputTokens).toBe(DRAFT_MAX_OUTPUT_TOKENS)
    expect(spec.input.context).toEqual({ week: '2026-W41', reflectionIds: R })
    // The routine path never needs a paid key.
    expect(m.getProviderForUser).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-Monday', at('04:40', '2026-10-06')],
    ['before 04:00 on Monday', at('03:59')],
    ['after the 05:56 deadline', at('05:56')],
  ])('plans nothing on %s', async (_l, now) => {
    expect(await constitutionSeedHandler.plan(USER, now)).toEqual([])
    expect(m.listSeedDominions).not.toHaveBeenCalled()
  })

  it('plans nothing once this week\'s job exists (no context re-read)', async () => {
    m.hasJobWithKeyLike.mockResolvedValue(true)
    expect(await constitutionSeedHandler.plan(USER, at('05:40'))).toEqual([])
    expect(m.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'constitution_seed', KEY)
    expect(m.listSeedDominions).not.toHaveBeenCalled()
  })

  it.each([
    ['a constitution is live', () => m.findLiveConstitutionRow.mockResolvedValue({ id: 'c' })],
    ['a draft is pending', () => m.listPendingConstitutionProposals.mockResolvedValue([{ id: 'p' }])],
    ['there is nothing to ground a draft in', () => {
      m.listSeedDominions.mockResolvedValue([{ id: D, name: 'Empty', vision: null, missionLong: null, objectives: [] }])
      m.listTopReflections.mockResolvedValue([])
    }],
  ])('plans nothing when %s', async (_l, arrange) => {
    arrange()
    expect(await constitutionSeedHandler.plan(USER, at('04:40'))).toEqual([])
  })
})

describe('constitution_seed apply', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('04:45'))
  })

  it('persists a grounded draft as the first-draft proposal (reflection ids only as provenance)', async () => {
    const res = await constitutionSeedHandler.apply(jobRow(), draft(), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: ['p1'], output: { principles: 3, answeredBy: 'routine' } })
    const [user, values, opts] = m.insertConstitutionProposal.mock.calls[0]
    expect(user).toBe(USER)
    expect(opts).toEqual({ firstDraftOnly: true })
    expect(values.sourceMetadata).toMatchObject({
      introspection: true,
      kind: 'constitution_amendment',
      status: 'pending',
      constitution: { basedOnVersion: 0, rationale: 'From reflections and the Swarm vision' },
    })
    expect(values.links.map((l: { target: string }) => l.target).sort()).toEqual([...R].sort())
    expect(m.writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'constitution-seed' })
  })

  it('rejects an ungrounded draft strictly (no repair, no write)', async () => {
    const res = await constitutionSeedHandler.apply(jobRow(), draft([['nope'], ['x'], [D]]), 'routine')
    expect(res).toMatchObject({ ok: false })
    expect(res.ok ? '' : res.reason).toMatch(/^parse_failed: /)
    expect(m.insertConstitutionProposal).not.toHaveBeenCalled()
    expect(m.getProviderForUser).not.toHaveBeenCalled()
  })

  it('rejects text with no JSON', async () => {
    const res = await constitutionSeedHandler.apply(jobRow(), 'I would rather not.', 'routine')
    expect(res.ok).toBe(false)
    expect(m.insertConstitutionProposal).not.toHaveBeenCalled()
  })

  it('completes as a no-op when the write lock finds a draft already landed', async () => {
    m.insertConstitutionProposal.mockResolvedValue({ written: false, memoryId: null, skipped: 'pending_draft_exists' })
    const res = await constitutionSeedHandler.apply(jobRow(), draft(), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: [], output: { skipped: 'pending_draft_exists', answeredBy: 'routine' } })
    expect(m.writeCronSuccessTrace).not.toHaveBeenCalled()
  })

  it('rejects a job planned in an earlier week, and one without context', async () => {
    const stale = jobRow({ input: { ...jobRow().input, context: { week: '2026-W40', reflectionIds: R } } })
    expect(await constitutionSeedHandler.apply(stale, draft(), 'routine')).toEqual({ ok: false, reason: 'stale_job: planned for 2026-W40' })
    const bare = jobRow({ input: { ...jobRow().input, context: undefined } })
    expect((await constitutionSeedHandler.apply(bare, draft(), 'routine')).ok).toBe(false)
    expect(m.insertConstitutionProposal).not.toHaveBeenCalled()
  })
})

describe('constitution_seed fallback', () => {
  it('defers to the Monday constitution-seed cron (no model call from the sweep)', async () => {
    const res = await constitutionSeedHandler.fallback(jobRow({ status: 'expired' }))
    expect(res).toEqual({ ok: false, reason: 'deferred to the Monday 05:58 UTC constitution-seed cron' })
    expect(m.getProviderForUser).not.toHaveBeenCalled()
  })
})
