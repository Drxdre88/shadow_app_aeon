import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import type { KairosIdeaShelf } from '@/lib/data/validators/kairos-idea-shelf'

const h = vi.hoisted(() => ({ shelf: null as unknown }))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(), listJobs: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({
  todayEnabled: vi.fn(() => true),
  loadTodayDigest: vi.fn(async () => null),
  appendTodayNotes: vi.fn(async () => undefined),
  countTodayEntriesSince: vi.fn(async () => 0),
}))
vi.mock('@/lib/data/idea-shelf', () => ({ listNearMissCandidates: vi.fn() }))
vi.mock('@/lib/data/kairos-idea-shelf', () => ({
  readKairosIdeaShelf: vi.fn(async () => h.shelf),
  mutateKairosIdeaShelf: vi.fn(async (_u: string, fn: (s: unknown) => { state: unknown; result: unknown }) => {
    const { state, result } = fn(h.shelf)
    if (state) h.shelf = state
    return result
  }),
}))

import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { listRecentMemories } from '@/lib/data/memories'
import { listNearMissCandidates } from '@/lib/data/idea-shelf'
import { mutateKairosIdeaShelf, readKairosIdeaShelf } from '@/lib/data/kairos-idea-shelf'
import { appendTodayNotes, countTodayEntriesSince, todayEnabled } from '@/lib/kairos/today'
import { PULSE_SYSTEM_PROMPT } from '@/lib/kairos/cadence/pulse-prompt'
import { renderShelfSection, withLaterField } from '@/lib/kairos/incubation/prompt'
import { emptyShelf, type NearMissRow } from '@/lib/kairos/incubation/shelf'
import { pulseHandler } from '../handlers/pulse'

const USER = 'user-1'
// 10:10Z on 15 Oct 2026 = 11:10 London (BST).
const NOW = new Date('2026-10-15T10:10:00.000Z')
const INBOX = [{ id: 'mem-in-1', title: 'Vendor contract renewal', createdAt: NOW, streamClass: 'idea' }]
const NIGHT = '2026-10-10'
const NEAR: NearMissRow = {
  id: 'idea-mem-4', title: 'Pricing ladder', claim: 'Three tiers beat one', nextStep: 'Draft the tiers', direction: 'Test',
  tournamentDate: NIGHT, rank: 4, status: 'eliminated', eliminatedReason: 'ranked_out',
}
const SURVIVORS: NearMissRow[] = [1, 2, 3].map((rank) => ({ ...NEAR, id: `s${rank}`, rank, status: 'survivor', eliminatedReason: null }))

function jobFrom(spec: ThinkingJobSpec): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'pulse', dominionId: null, externalKey: spec.externalKey, status: 'claimed', input: spec.input,
    output: null, claimedBy: 'routine:pulse', claimToken: 't', claimedAt: NOW, deadlineAt: NOW,
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
  }
}

async function planOne(): Promise<ThinkingJobSpec> {
  const specs = await pulseHandler.plan(USER, NOW)
  expect(specs).toHaveLength(1)
  return specs[0]
}

const answer = (later?: unknown) => JSON.stringify({ notes: ['Owner priced the Pro tier.'], attention: [], ...(later ? { later } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  h.shelf = emptyShelf()
  process.env.KAIROS_DAYTIME_THINKING = '1'
  vi.mocked(todayEnabled).mockReturnValue(true)
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(countTodayEntriesSince).mockResolvedValue(2)
  vi.mocked(listRecentMemories).mockResolvedValue(INBOX)
  vi.mocked(listNearMissCandidates).mockResolvedValue([...SURVIVORS, NEAR])
})
afterEach(() => {
  vi.useRealTimers()
  delete process.env.KAIROS_DAYTIME_THINKING
  delete process.env.KAIROS_IDEA_SHELF
  delete process.env.KAIROS_STAGE
})

describe('flag off: the pulse is byte-identical', () => {
  it('plan: base system prompt, no shelf section, context {slot, inbox}; the shelf is never read', async () => {
    const spec = await planOne()
    expect(spec.input.system).toBe(PULSE_SYSTEM_PROMPT)
    expect(spec.input.prompt).not.toContain('set aside')
    expect(Object.keys(spec.input.context ?? {})).toEqual(['slot', 'inbox'])
    expect(listNearMissCandidates).not.toHaveBeenCalled()
    expect(readKairosIdeaShelf).not.toHaveBeenCalled()
  })

  it('on with nothing ripe plans the same spec as off', async () => {
    const off = await planOne()
    process.env.KAIROS_IDEA_SHELF = '1'
    vi.mocked(listNearMissCandidates).mockResolvedValue(SURVIVORS)
    expect(await planOne()).toEqual(off)
    expect(mutateKairosIdeaShelf).not.toHaveBeenCalled()
  })

  it('apply: a forged later on a job without a shelf item changes nothing', async () => {
    const spec = await planOne()
    const res = await pulseHandler.apply(jobFrom(spec), answer({ shelfId: NEAR.id, connection: 'x' }), 'routine')
    expect(appendTodayNotes).toHaveBeenCalledWith(USER, ['Owner priced the Pro tier.'], 'pulse', 'job-1')
    expect(res.ok && Object.keys(res.output ?? {})).toEqual(['notes', 'attention', 'dropped', 'answeredBy'])
    expect(mutateKairosIdeaShelf).not.toHaveBeenCalled()
  })

  it('daytime thinking off: nothing planned and the near-miss query never runs', async () => {
    process.env.KAIROS_IDEA_SHELF = '1'
    delete process.env.KAIROS_DAYTIME_THINKING
    expect(await pulseHandler.plan(USER, NOW)).toEqual([])
    expect(listNearMissCandidates).not.toHaveBeenCalled()
  })
})

describe('KAIROS_IDEA_SHELF', () => {
  it('observe: prompts unchanged, the would-be offer is only recorded', async () => {
    const off = await planOne()
    process.env.KAIROS_IDEA_SHELF = 'observe'
    const spec = await planOne()
    expect(spec.input.system).toBe(off.input.system)
    expect(spec.input.prompt).toBe(off.input.prompt)
    expect(spec.input.context).toMatchObject({ shelfObserved: { id: NEAR.id, date: NIGHT } })
    expect(mutateKairosIdeaShelf).not.toHaveBeenCalled()
    const res = await pulseHandler.apply(jobFrom(spec), answer({ shelfId: NEAR.id, connection: 'x' }), 'routine')
    expect(res.ok && res.output?.shelf).toEqual({ observed: NEAR.id })
    expect(vi.mocked(appendTodayNotes).mock.calls[0][1]).toEqual(['Owner priced the Pro tier.'])
  })

  it('1: one ripe near-miss is offered (later field + data section) and the offer is booked', async () => {
    const off = await planOne()
    process.env.KAIROS_IDEA_SHELF = '1'
    const spec = await planOne()
    expect(listNearMissCandidates).toHaveBeenCalledWith(USER, '2026-10-01', '2026-10-13')
    expect(spec.input.system).toBe(withLaterField(PULSE_SYSTEM_PROMPT))
    expect(spec.input.prompt).toBe(`${off.input.prompt}${renderShelfSection(NEAR)}`)
    expect(spec.input.context).toMatchObject({ shelf: { id: NEAR.id, title: NEAR.title, date: NIGHT } })
    expect((h.shelf as KairosIdeaShelf).items).toEqual([expect.objectContaining({ id: NEAR.id, offers: 1, slot: spec.externalKey })])
  })

  it('apply with a genuine connection: one today note + one stage thought, never a message', async () => {
    process.env.KAIROS_IDEA_SHELF = '1'
    process.env.KAIROS_STAGE = '1'
    const spec = await planOne()
    const res = await pulseHandler.apply(jobFrom(spec), answer({ shelfId: NEAR.id, connection: 'Today you priced the Pro tier alone.' }), 'routine')
    const line = 'It came to me later: Pricing ladder — Today you priced the Pro tier alone.'
    expect(appendTodayNotes).toHaveBeenCalledWith(USER, ['Owner priced the Pro tier.', line], 'pulse', 'job-1')
    expect(res.ok && res.output?.shelf).toEqual({ offered: NEAR.id, resurfaced: true })
    expect(res.ok && res.thoughts?.[0]).toMatchObject({ text: line, surprise: 0.6, cites: [NEAR.id] })
    expect((h.shelf as KairosIdeaShelf).lastResurfaceDay).toBe('2026-10-15')
  })

  it('a second resurface the same London day is refused', async () => {
    process.env.KAIROS_IDEA_SHELF = '1'
    const spec = await planOne()
    h.shelf = { ...(h.shelf as KairosIdeaShelf), lastResurfaceDay: '2026-10-15' }
    const res = await pulseHandler.apply(jobFrom(spec), answer({ shelfId: NEAR.id, connection: 'x' }), 'routine')
    expect(vi.mocked(appendTodayNotes).mock.calls[0][1]).toEqual(['Owner priced the Pro tier.'])
    expect(res.ok && res.output?.shelf).toEqual({ offered: NEAR.id, resurfaced: false })
  })

  it('a forged shelfId is ignored', async () => {
    process.env.KAIROS_IDEA_SHELF = '1'
    const spec = await planOne()
    const res = await pulseHandler.apply(jobFrom(spec), answer({ shelfId: 'other', connection: 'x' }), 'routine')
    expect(vi.mocked(appendTodayNotes).mock.calls[0][1]).toEqual(['Owner priced the Pro tier.'])
    expect(res.ok && res.output?.shelf).toEqual({ offered: NEAR.id, resurfaced: false })
  })

  it('a shelf read failure leaves the pulse unchanged', async () => {
    const off = await planOne()
    process.env.KAIROS_IDEA_SHELF = '1'
    vi.mocked(readKairosIdeaShelf).mockRejectedValueOnce(new Error('corrupt'))
    expect(await planOne()).toEqual(off)
  })
})

describe('incubation never speaks and never touches dreams', () => {
  it('no speak or dreams import in the pulse or incubation sources', () => {
    const root = path.resolve(__dirname, '../..')
    for (const f of ['thinking/handlers/pulse.ts', 'incubation/pulse-shelf.ts', 'incubation/shelf.ts', 'incubation/prompt.ts', 'incubation/flag.ts']) {
      const src = readFileSync(path.join(root, f), 'utf8')
      expect(src, f).not.toMatch(/deliverKairosSpeak|from ['"][^'"]*\/speak['"]|lib\/kairos\/dreams/)
    }
  })
})
