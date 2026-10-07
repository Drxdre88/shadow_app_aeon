import { describe, it, expect } from 'vitest'
import {
  forecastCard,
  forecastBoard,
  forecastStatus,
  remainingColumns,
  dueDeadline,
  type ForecastColumn,
  type ColumnDwell,
  type ForecastTaskInput,
} from '../forecast'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const DAY = 24 * 3_600_000

const COLUMNS: ForecastColumn[] = [
  { id: 'c-backlog', name: 'Backlog', orderIndex: 0 },
  { id: 'c-live', name: 'Live', orderIndex: 1 },
  { id: 'c-review', name: 'Review', orderIndex: 2 },
  { id: 'c-done', name: 'Done', orderIndex: 3 },
]

const DWELL: ColumnDwell[] = [
  { column: 'Backlog', avgHours: 48, count: 12 },
  { column: 'Live', avgHours: 72, count: 9 },
  { column: 'Review', avgHours: 24, count: 7 },
]

const ctx = (over: Partial<{ columns: ForecastColumn[]; dwell: ColumnDwell[] }> = {}) => ({ columns: COLUMNS, dwell: DWELL, now: NOW, ...over })

function task(over: Partial<ForecastTaskInput> = {}): ForecastTaskInput {
  return { id: 't1', columnId: 'c-live', endDate: null, estimateMinutes: 120, computedEnd: null, ...over }
}

describe('remainingColumns', () => {
  it('runs from the card\u2019s column up to (not including) Done', () => {
    expect(remainingColumns(COLUMNS, 'c-live').map((c) => c.name)).toEqual(['Live', 'Review'])
  })
  it('is empty for a card already in Done', () => {
    expect(remainingColumns(COLUMNS, 'c-done')).toEqual([])
  })
  it('treats an unknown or missing column as the start of the board', () => {
    expect(remainingColumns(COLUMNS, null).map((c) => c.name)).toEqual(['Backlog', 'Live', 'Review'])
  })
})

describe('forecastStatus', () => {
  const due = new Date('2026-10-10T00:00:00.000Z')
  it('counts a date-only due date until the end of that day', () => {
    expect(dueDeadline(due).toISOString()).toBe('2026-10-10T23:59:59.999Z')
    expect(forecastStatus(new Date('2026-10-10T18:00:00Z'), due)).toBe('at_risk')
  })
  it('is late once the forecast passes the deadline', () => {
    expect(forecastStatus(new Date('2026-10-11T01:00:00Z'), due)).toBe('late')
  })
  it('is at risk within 2 days of the deadline and on track beyond that', () => {
    expect(forecastStatus(new Date('2026-10-09T00:00:00Z'), due)).toBe('at_risk')
    expect(forecastStatus(new Date('2026-10-07T00:00:00Z'), due)).toBe('on_track')
  })
  it('is no_due_date without an end date', () => {
    expect(forecastStatus(NOW, null)).toBe('no_due_date')
  })
})

describe('forecastCard', () => {
  it('adds the remaining columns\u2019 average dwell to now', () => {
    const f = forecastCard(task({ endDate: new Date('2026-10-20T00:00:00Z') }), ctx())!
    expect(f.forecastEnd).toBe(new Date(NOW.getTime() + 96 * 3_600_000).toISOString())
    expect(f.status).toBe('on_track')
    expect(f.confidence).toBe('normal')
    expect(f.basis.columns).toEqual(['Live', 'Review'])
    expect(f.reason).toMatch(/Based on how long cards sat in Live \(about 3 days\), Review \(about 1 day\) over the last 30 days/)
  })

  it('takes the later of the schedule\u2019s computedEnd and the dwell estimate', () => {
    const later = new Date(NOW.getTime() + 10 * DAY)
    const f = forecastCard(task({ computedEnd: later }), ctx())!
    expect(f.forecastEnd).toBe(later.toISOString())
    expect(f.reason).toMatch(/schedule has it finishing later/)

    const earlier = new Date(NOW.getTime() + DAY)
    const g = forecastCard(task({ computedEnd: earlier }), ctx())!
    expect(g.forecastEnd).toBe(new Date(NOW.getTime() + 96 * 3_600_000).toISOString())
    expect(g.reason).not.toMatch(/schedule/)
  })

  it('flags late and at-risk cards against their due date', () => {
    expect(forecastCard(task({ endDate: new Date('2026-10-08T00:00:00Z') }), ctx())!.status).toBe('late')
    expect(forecastCard(task({ endDate: new Date('2026-10-11T00:00:00Z') }), ctx())!.status).toBe('at_risk')
  })

  it('marks an estimated card without a due date as no_due_date', () => {
    const f = forecastCard(task({ endDate: null, estimateMinutes: 60 }), ctx())!
    expect(f.status).toBe('no_due_date')
    expect(f.dueDate).toBeNull()
    expect(f.reason).toMatch(/no due date/)
  })

  it('is low confidence when fewer than 5 cards fed any remaining column', () => {
    const dwell = [{ column: 'Live', avgHours: 10, count: 3 }, { column: 'Review', avgHours: 5, count: 20 }]
    const f = forecastCard(task(), ctx({ dwell }))!
    expect(f.confidence).toBe('low')
    expect(f.basis.samples).toBe(3)
    expect(f.reason).toMatch(/rough guess/)
  })

  it('names columns with no recent history and stays low confidence', () => {
    const f = forecastCard(task(), ctx({ dwell: [{ column: 'Live', avgHours: 72, count: 9 }] }))!
    expect(f.confidence).toBe('low')
    expect(f.reason).toMatch(/No recent history for Review/)
  })

  it('skips cards with neither a due date nor an estimate', () => {
    expect(forecastCard(task({ endDate: null, estimateMinutes: null }), ctx())).toBeNull()
  })

  it('skips cards already in Done', () => {
    expect(forecastCard(task({ columnId: 'c-done', endDate: new Date('2026-10-08T00:00:00Z') }), ctx())).toBeNull()
  })

  it('skips cards with no history and no schedule to base a guess on', () => {
    expect(forecastCard(task(), ctx({ dwell: [] }))).toBeNull()
    expect(forecastCard(task({ computedEnd: new Date(NOW.getTime() + DAY) }), ctx({ dwell: [] }))!.confidence).toBe('low')
  })
})

describe('forecastBoard', () => {
  it('returns forecasts only for dated or estimated open cards', () => {
    const out = forecastBoard([
      task({ id: 'dated', estimateMinutes: null, endDate: new Date('2026-10-20T00:00:00Z') }),
      task({ id: 'estimated' }),
      task({ id: 'bare', estimateMinutes: null }),
      task({ id: 'finished', columnId: 'c-done' }),
    ], ctx())
    expect(out.map((f) => f.taskId)).toEqual(['dated', 'estimated'])
  })
})
