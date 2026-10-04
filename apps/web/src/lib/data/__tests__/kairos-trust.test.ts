import { beforeEach, describe, expect, it, vi } from 'vitest'

// readKairosTrust: joins the reads, lists failed ones in `missing`, filters by area.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('../goals', () => ({ listGoalRecordsSince: vi.fn() }))
vi.mock('../idea-taste', () => ({ listIdeaTasteRows: vi.fn() }))
vi.mock('../idea-inputs', () => ({ listActiveDominions: vi.fn() }))
vi.mock('../kairos-predictions', () => ({ readKairosPredictions: vi.fn() }))
vi.mock('../kairos-promises', () => ({ readKairosPromises: vi.fn() }))
vi.mock('../kairos-surprise', () => ({ readKairosSurprise: vi.fn() }))

import { listGoalRecordsSince } from '../goals'
import { listIdeaTasteRows } from '../idea-taste'
import { listActiveDominions } from '../idea-inputs'
import { readKairosPredictions } from '../kairos-predictions'
import { readKairosPromises } from '../kairos-promises'
import { readKairosSurprise } from '../kairos-surprise'
import { readKairosTrust } from '../kairos-trust'

const NOW = new Date('2026-10-05T08:00:00.000Z')
const pred = (dominionId: string, topic: string) => ({
  id: 'p', seq: 1, claim: 'c', probability: 0.8, dueDate: '2026-10-01', topic, dominionId, basisIds: [],
  check: { kind: 'owner_verdict' }, source: { kind: 'reflect', jobId: 'j' }, createdAt: '2026-09-20T00:00:00.000Z',
  status: 'right', settledAt: '2026-10-01T00:00:00.000Z',
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(readKairosPredictions).mockResolvedValue({ v: 1, nextSeq: 3, open: [], closed: [pred('d1', 'delivery'), pred('d2', 'risk')] } as never)
  vi.mocked(readKairosPromises).mockResolvedValue({ v: 1, nextSeq: 1, open: [], closed: [] })
  vi.mocked(listGoalRecordsSince).mockRejectedValue(new Error('db down'))
  vi.mocked(listIdeaTasteRows).mockResolvedValue([])
  vi.mocked(listActiveDominions).mockResolvedValue([{ id: 'd1', name: 'AEON' }, { id: 'd2', name: 'Body' }])
  vi.mocked(readKairosSurprise).mockResolvedValue({ v: 1, events: [], seen: [], lp: null, replay: null })
})

describe('readKairosTrust', () => {
  it('builds the view from what was read and lists failed reads', async () => {
    const view = await readKairosTrust('u', { now: NOW })
    expect(view.missing).toEqual(['goals'])
    expect(view.mode).toEqual({ trust: 'off', askFirst: 'off' })
    expect(view.generatedAt).toBe(NOW.toISOString())
    expect(view.areas.map((a) => a.key).sort()).toEqual(['d1', 'd2', 'topic:delivery', 'topic:risk'])
    expect(listGoalRecordsSince).toHaveBeenCalledWith('u', new Date(NOW.getTime() - 120 * 86_400_000))
  })

  it('filters to one area by label or key, case-insensitively', async () => {
    expect((await readKairosTrust('u', { now: NOW, area: 'aeon' })).areas.map((a) => a.key)).toEqual(['d1'])
    expect((await readKairosTrust('u', { now: NOW, area: 'TOPIC:RISK' })).areas.map((a) => a.key)).toEqual(['topic:risk'])
    expect((await readKairosTrust('u', { now: NOW, area: 'nowhere' })).areas).toEqual([])
  })
})
