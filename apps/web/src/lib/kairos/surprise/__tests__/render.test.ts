import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { toKairosSurpriseView } from '@/lib/data/kairos-surprise'
import { kairosSurpriseViewSchema } from '@/lib/data/validators/kairos-surprise'
import { emptySurpriseLedger } from '../ledger'
import { renderSurpriseMarkdown } from '../render'

describe('renderSurpriseMarkdown', () => {
  it('renders an empty ledger', () => {
    const md = renderSurpriseMarkdown(toKairosSurpriseView(emptySurpriseLedger(), { now: new Date('2026-10-03T00:00:00Z') }))
    expect(md).toContain('Last 7 days: 0 events')
    expect(md).toContain('(none)')
    expect(md).toContain('(not computed)')
    expect(md).toContain('(none yet)')
  })

  it('renders events, lp and replay from the shared view', () => {
    const now = new Date('2026-10-03T12:00:00Z')
    const view = toKairosSurpriseView({
      ...emptySurpriseLedger(),
      events: [{ id: 's_00000001', key: 'k', at: '2026-10-03T10:00:00.000Z', kind: 'promise_lapsed', s: 0.6, dominionId: null, refs: { beliefIds: ['b'], memoryIds: [] }, opened: ['b'], credited: { pos: 0, neg: 1 } }],
      lp: { computedAt: '2026-10-03T03:00:00.000Z', areas: [{ key: 'topic:delivery', lp: 0.12, brierNew: 0.1, nNew: 3, nOld: 3 }] },
      replay: { night: '2026-10-03', ids: ['a', 'b'], prevHits: 1 },
    }, { now })
    expect(kairosSurpriseViewSchema.safeParse(view).success).toBe(true)
    const md = renderSurpriseMarkdown(view)
    expect(md).toContain('promise_lapsed 1')
    expect(md).toContain('2026-10-03 10:00 promise_lapsed s=0.6 — beliefs 1, memories 0, opened 1, credited +0/−1')
    expect(md).toContain('- topic:delivery: lp 0.12')
    expect(md).toContain("night 2026-10-03: 2 memories; 1 of the previous night's set cited")
  })
})
