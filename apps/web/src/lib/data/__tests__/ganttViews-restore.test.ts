import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SQL } from 'drizzle-orm'

// The undo of a timeline reset is one batched write, not one action per card.
// This pins the SQL the way tasks-startedAt does: rendered through the real
// dialect, every value a bind parameter, dates as ISO text with a ::timestamp
// cast, chunked at RESTORE_CHUNK, one touchProject for the whole batch.

const state = vi.hoisted(() => ({ executed: [] as unknown[], transactions: 0 }))

vi.mock('@/lib/db', () => {
  const tx = {
    execute: vi.fn(async (q: unknown) => {
      state.executed.push(q)
    }),
  }
  return {
    db: {
      ...tx,
      transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        state.transactions += 1
        return fn(tx)
      }),
    },
  }
})

vi.mock('../projects', () => ({ touchProject: vi.fn() }))

import { restoreTimelineSnapshot, RESTORE_CHUNK, type TimelineResetSnapshotEntry } from '../ganttViews'
import { touchProject } from '../projects'

const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const dialect = new PgDialect()

function rendered(index: number) {
  const q = state.executed[index]
  expect(q).toBeInstanceOf(SQL)
  return dialect.sqlToQuery(q as SQL)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.executed.length = 0
  state.transactions = 0
})

describe('restoreTimelineSnapshot', () => {
  it('writes the whole snapshot in one statement, one transaction, one touch', async () => {
    const entries: TimelineResetSnapshotEntry[] = [
      { id: B, startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-03T00:00:00.000Z', onTimeline: true },
      { id: A, startDate: null, endDate: null, onTimeline: false },
    ]
    await expect(restoreTimelineSnapshot(PROJECT_ID, entries)).resolves.toBe(2)
    expect(state.transactions).toBe(1)
    expect(state.executed).toHaveLength(1)

    const { sql, params } = rendered(0)
    expect(sql).toMatch(/update board_tasks as t/)
    expect(sql).toMatch(/set on_timeline = v\.on_timeline,\s+start_date = v\.start_date,\s+end_date = v\.end_date,\s+updated_at = \$1::timestamp/)
    expect(sql).toMatch(
      /from \(values \(\$2::uuid, \$3::boolean, \$4::timestamp, \$5::timestamp\), \(\$6::uuid, \$7::boolean, \$8::timestamp, \$9::timestamp\)\) as v\(id, on_timeline, start_date, end_date\)/,
    )
    expect(sql).toMatch(/where t\.id = v\.id and t\.project_id = \$10/)
    expect(params).toEqual([
      expect.stringMatching(/Z$/),
      B, true, '2026-09-01T00:00:00.000Z', '2026-09-03T00:00:00.000Z',
      A, false, null, null,
      PROJECT_ID,
    ])
    for (const p of params) expect(p).not.toBeInstanceOf(Date)
    expect(touchProject).toHaveBeenCalledTimes(1)
    expect(touchProject).toHaveBeenCalledWith(PROJECT_ID, { type: 'task:updated' })
  })

  it('chunks at RESTORE_CHUNK and still touches the project once', async () => {
    const entries = Array.from({ length: RESTORE_CHUNK + 1 }, (_, i): TimelineResetSnapshotEntry => ({
      id: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
      startDate: null,
      endDate: null,
      onTimeline: true,
    }))
    await expect(restoreTimelineSnapshot(PROJECT_ID, entries)).resolves.toBe(RESTORE_CHUNK + 1)
    expect(state.executed).toHaveLength(2)
    expect(rendered(0).params).toHaveLength(RESTORE_CHUNK * 4 + 2)
    expect(rendered(1).params).toHaveLength(1 * 4 + 2)
    expect(touchProject).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an empty snapshot', async () => {
    await expect(restoreTimelineSnapshot(PROJECT_ID, [])).resolves.toBe(0)
    expect(state.transactions).toBe(0)
    expect(touchProject).not.toHaveBeenCalled()
  })
})
