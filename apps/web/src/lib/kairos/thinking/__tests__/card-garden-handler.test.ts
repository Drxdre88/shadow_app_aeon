import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// card_garden handler: weekly (Mondays from 06:00Z, one job per ISO week),
// only with KAIROS_CARD_GARDEN on; apply files ≤10 pending proposals for
// cards from the job's own context and announces each new one.

const h = vi.hoisted(() => ({
  hasJobWithKeyLike: vi.fn(async () => false),
  gather: vi.fn(),
  insertCardGardenProposal: vi.fn(),
  writeCronSuccessTrace: vi.fn(async () => undefined),
  announceCardGarden: vi.fn(async () => true),
}))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: h.hasJobWithKeyLike }))
vi.mock('@/lib/kairos/card-garden/gather', () => ({ gatherCardGardenCandidates: h.gather }))
vi.mock('@/lib/data/card-garden-proposals', () => ({ insertCardGardenProposal: h.insertCardGardenProposal }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronSuccessTrace: h.writeCronSuccessTrace }))
vi.mock('@/lib/kairos/card-garden/announce', () => ({ announceCardGarden: h.announceCardGarden }))

import { cardGardenHandler, cardGardenJobKey } from '../handlers/card-garden'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

const USER = 'user-1'
const MONDAY = new Date('2026-10-05T07:00:00.000Z')
const cards = Array.from({ length: 25 }, (_, i) => ({ taskId: `t-${i}`, name: `Card ${i}`, projectId: 'p-1', columnName: 'Live', ageDays: 30 + i, priority: 'medium' }))
const boards = [{ projectId: 'p-1', projectName: 'Beta', columns: ['Cryo', 'Live', 'Done'], parkColumn: 'Cryo', doneColumn: 'Done', dwell: [] }]

function job(context: unknown): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'card_garden', dominionId: null, externalKey: 'card_garden:2026-W41', status: 'claimed',
    input: { system: 's', prompt: 'p', context: context as Record<string, unknown> }, output: null, claimedBy: 'routine', claimToken: 't',
    claimedAt: new Date(), deadlineAt: new Date(), completedAt: null, attempts: 1, error: null, createdAt: new Date(), updatedAt: new Date(),
  }
}

const reply = (proposals: unknown[]) => '```json\n' + JSON.stringify({ proposals }) + '\n```'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_CARD_GARDEN', '1')
  h.gather.mockResolvedValue({ boards, cards })
  let n = 0
  h.insertCardGardenProposal.mockImplementation(async () => ({ id: `prop-${++n}`, written: true }))
})
afterEach(() => vi.unstubAllEnvs())

describe('card_garden plan', () => {
  it('plans one job per ISO week, keyed card_garden:<isoWeek>, over at most 25 cards', async () => {
    const specs = await cardGardenHandler.plan(USER, MONDAY)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ kind: 'card_garden', externalKey: 'card_garden:2026-W41', dominionId: null })
    expect(cardGardenJobKey('2026-W41')).toBe('card_garden:2026-W41')
    expect(h.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'card_garden', 'card_garden:2026-W41')
    expect((specs[0].input.context as { cards: unknown[] }).cards).toHaveLength(25)
    expect(specs[0].input.prompt).toContain('BEGIN BOARD DATA')
  })

  it('plans nothing when switched off, outside Monday 06:00Z, already planned this week, or with no stale cards', async () => {
    vi.stubEnv('KAIROS_CARD_GARDEN', '0')
    expect(await cardGardenHandler.plan(USER, MONDAY)).toEqual([])
    vi.stubEnv('KAIROS_CARD_GARDEN', '1')
    expect(await cardGardenHandler.plan(USER, new Date('2026-10-05T05:59:00.000Z'))).toEqual([])
    expect(await cardGardenHandler.plan(USER, new Date('2026-10-06T07:00:00.000Z'))).toEqual([])
    expect(h.gather).not.toHaveBeenCalled()
    h.hasJobWithKeyLike.mockResolvedValueOnce(true)
    expect(await cardGardenHandler.plan(USER, MONDAY)).toEqual([])
    h.gather.mockResolvedValueOnce({ boards: [], cards: [] })
    expect(await cardGardenHandler.plan(USER, MONDAY)).toEqual([])
  })
})

describe('card_garden apply', () => {
  const context = async () => (await cardGardenHandler.plan(USER, MONDAY))[0].input.context

  it('files at most 10 proposals, only for cards in the context, and announces each', async () => {
    const ctx = await context()
    const answer = [
      { taskId: 'invented-id', action: 'kill', reason: 'not listed' },
      ...cards.map((c) => ({ taskId: c.taskId, action: 'kill', reason: 'old' })),
    ]
    const res = await cardGardenHandler.apply(job(ctx), reply(answer), 'routine')
    expect(res).toMatchObject({ ok: true, output: { proposals: 10, dropped: 16 } })
    expect(h.insertCardGardenProposal).toHaveBeenCalledTimes(10)
    const ids = h.insertCardGardenProposal.mock.calls.map((c) => (c[1] as { pick: { taskId: string } }).pick.taskId)
    expect(ids.every((id) => cards.some((c) => c.taskId === id))).toBe(true)
    expect(h.insertCardGardenProposal.mock.calls[0][1]).toMatchObject({ externalKey: 'card_garden:2026-W41:t-0', jobId: 'job-1' })
    expect(h.announceCardGarden).toHaveBeenCalledTimes(10)
  })

  it('does not re-announce a proposal already filed, and a Telegram failure never fails the job', async () => {
    const ctx = await context()
    h.insertCardGardenProposal.mockResolvedValueOnce({ id: 'prop-old', written: false })
    h.announceCardGarden.mockRejectedValueOnce(new Error('telegram down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await cardGardenHandler.apply(job(ctx), reply([
      { taskId: 't-0', action: 'finish', reason: 'done' },
      { taskId: 't-1', action: 'kill', reason: 'old' },
    ]), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['prop-old', expect.any(String)] })
    expect(h.announceCardGarden).toHaveBeenCalledOnce()
    err.mockRestore()
  })

  it('skips when nothing grounds, fails on a bad answer or context, and has no fallback', async () => {
    const ctx = await context()
    expect(await cardGardenHandler.apply(job(ctx), reply([{ taskId: 'ghost', action: 'kill', reason: '' }]), 'routine'))
      .toMatchObject({ ok: true, memoryIds: [], output: { skipped: 'no_proposals' } })
    expect(await cardGardenHandler.apply(job(ctx), 'no json here', 'routine')).toMatchObject({ ok: false, reason: expect.stringContaining('parse_failed') })
    expect(await cardGardenHandler.apply(job({}), reply([]), 'routine')).toMatchObject({ ok: false, reason: expect.stringContaining('bad_job') })
    expect(await cardGardenHandler.fallback(job(ctx))).toMatchObject({ ok: false })
    expect(h.insertCardGardenProposal).not.toHaveBeenCalled()
  })
})
