import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurpriseEvent } from '@/lib/data/validators/kairos-surprise'

const m = vi.hoisted(() => ({
  readKairosSurprise: vi.fn(),
  readKairosPredictions: vi.fn(),
  readKairosPromises: vi.fn(),
}))
vi.mock('@/lib/data/kairos-surprise', () => ({ readKairosSurprise: m.readKairosSurprise }))
vi.mock('@/lib/data/kairos-predictions', () => ({ readKairosPredictions: m.readKairosPredictions }))
vi.mock('@/lib/data/kairos-promises', () => ({ readKairosPromises: m.readKairosPromises }))

import { buildSurpriseAmbient, readSurpriseAmbient } from '../stage-source'

const NOW = new Date('2026-10-03T12:00:00.000Z')
const PRED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BEL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let n = 0
const ev = (over: Partial<SurpriseEvent>): SurpriseEvent => ({
  id: `s_${(n++).toString(16).padStart(8, '0')}`,
  key: `k${n}`,
  at: '2026-10-03T10:00:00.000Z',
  kind: 'prediction_wrong',
  s: 0.8,
  dominionId: null,
  refs: { beliefIds: [], memoryIds: [] },
  opened: [],
  ...over,
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('buildSurpriseAmbient', () => {
  it('keys by event id and maps source / tier per kind', () => {
    const events = [
      ev({ kind: 'prediction_wrong', at: '2026-10-03T11:00:00.000Z', refs: { predictionId: PRED, beliefIds: [BEL], memoryIds: [] } }),
      ev({ kind: 'owner_correction', at: '2026-10-03T10:00:00.000Z' }),
      ev({ kind: 'promise_lapsed', s: 0.6, at: '2026-10-03T09:00:00.000Z' }),
    ]
    const out = buildSurpriseAmbient({ events }, NOW, { predictions: new Map([[PRED, `Card ${PRED} ships by Friday`]]) })
    expect(out.map((c) => [c.key, c.source, c.tier])).toEqual([
      [`surprise:${events[0].id}`, 'prediction', 'deep'],
      [`surprise:${events[1].id}`, 'owner', 'owner'],
      [`surprise:${events[2].id}`, 'promise', 'deep'],
    ])
    expect(out[0]).toMatchObject({ surprise: 0.8, importance: 0.6 })
    expect(out[0].text).toContain('ships by Friday')
    for (const c of out) expect(c.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|s_[0-9a-f]{8}/)
  })

  it('engine findings post as job/deep', () => {
    const out = buildSurpriseAmbient({ events: [ev({ kind: 'contradiction', s: 0.5 }), ev({ kind: 'support_lost', s: 0.9 })] }, NOW)
    expect(out.every((c) => c.source === 'job' && c.tier === 'deep')).toBe(true)
  })

  it('only s ≥ .5 posts, an aha always; old and future events skipped; ≤3 newest', () => {
    const out = buildSurpriseAmbient({
      events: [
        ev({ kind: 'support_lost', s: 0.4 }),
        ev({ kind: 'aha', s: 0.3, refs: { beliefIds: ['x', 'y'], memoryIds: [] } }),
        ev({ s: 0.9, at: '2026-10-01T10:00:00.000Z' }),
        ev({ s: 0.9, at: '2026-10-04T10:00:00.000Z' }),
      ],
    }, NOW)
    expect(out.map((c) => c.kind)).toEqual(['aha'])
    expect(out[0]).toMatchObject({ surprise: 0.3, text: 'Something clicked: one new memory supports 2 beliefs at once.' })
    const many = buildSurpriseAmbient({ events: Array.from({ length: 6 }, () => ev({})) }, NOW)
    expect(many).toHaveLength(3)
  })
})

describe('readSurpriseAmbient', () => {
  it('is off unless KAIROS_SURPRISE_STAGE=1 and the stage is not off', async () => {
    expect(await readSurpriseAmbient('u', NOW)).toEqual([])
    vi.stubEnv('KAIROS_SURPRISE_STAGE', '1')
    expect(await readSurpriseAmbient('u', NOW)).toEqual([])
    expect(m.readKairosSurprise).not.toHaveBeenCalled()
  })

  it('reads the ledger and looks up the claim text', async () => {
    vi.stubEnv('KAIROS_SURPRISE_STAGE', '1')
    vi.stubEnv('KAIROS_STAGE', 'observe')
    m.readKairosSurprise.mockResolvedValue({ v: 1, events: [ev({ refs: { predictionId: PRED, beliefIds: [], memoryIds: [] } })], seen: [], lp: null, replay: null })
    m.readKairosPredictions.mockResolvedValue({ open: [], closed: [{ id: PRED, claim: 'The release slips a week' }] })
    const [item] = await readSurpriseAmbient('u', NOW)
    expect(item.text).toBe('A prediction I was confident in was wrong: The release slips a week')
    expect(m.readKairosPromises).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    vi.stubEnv('KAIROS_SURPRISE_STAGE', '1')
    vi.stubEnv('KAIROS_STAGE', '1')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.readKairosSurprise.mockRejectedValue(new Error('corrupt'))
    expect(await readSurpriseAmbient('u', NOW)).toEqual([])
  })
})
