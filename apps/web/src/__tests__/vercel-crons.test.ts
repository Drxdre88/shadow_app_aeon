import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Vercel cron fleet contract (docs/kairos/33-34): the daily message replaced
// the evening digest and the morning briefs; the nightly engine and thinking
// sweep stay scheduled; synthesis health (an input to the 07:00 daily
// message) runs before it; the crons retired in Kairos 0.17 stay gone.

interface CronEntry { path: string; schedule: string }

const vercel = JSON.parse(readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8')) as { crons?: CronEntry[] }
const crons = vercel.crons ?? []
const byPath = (p: string) => crons.filter((c) => c.path === p)

// UTC minutes-of-day of every fire time for a "M H * * *"-style schedule with
// numeric / comma-listed minute and hour fields.
function fireMinutes(schedule: string): number[] {
  const [min, hour] = schedule.trim().split(/\s+/)
  const mins = min.split(',').map(Number)
  const hours = hour.split(',').map(Number)
  return hours.flatMap((h) => mins.map((m) => h * 60 + m))
}

describe('vercel.json crons', () => {
  it('parses and every entry has a path + schedule', () => {
    expect(crons.length).toBeGreaterThan(0)
    for (const c of crons) {
      expect(c.path).toMatch(/^\/api\//)
      expect(c.schedule.trim().split(/\s+/)).toHaveLength(5)
    }
  })

  it('schedules the daily message at 07:00 and 08:00 UTC (London 08:00 across DST)', () => {
    expect(byPath('/api/cron/daily-message')).toEqual([{ path: '/api/cron/daily-message', schedule: '0 7,8 * * *' }])
  })

  it('no longer schedules the deleted evening digest', () => {
    expect(crons.some((c) => c.path.startsWith('/api/cron/digest'))).toBe(false)
  })

  it('schedules the constitution seed, memory engine and thinking sweep', () => {
    expect(byPath('/api/cron/constitution-seed')).toHaveLength(1)
    expect(byPath('/api/cron/memory-engine')).toHaveLength(1)
    expect(byPath('/api/cron/thinking-sweep')).toHaveLength(1)
  })

  it.each(['/api/cron/synthesis-health'])(
    '%s runs before 07:00 UTC (an input to the daily message)',
    (p) => {
      const entries = byPath(p)
      expect(entries).toHaveLength(1)
      const times = fireMinutes(entries[0]!.schedule)
      expect(times.length).toBeGreaterThan(0)
      for (const t of times) expect(t).toBeLessThan(7 * 60)
    },
  )

  it.each(['briefer', 'introspection', 'contradiction-scan', 'micro-consolidate', 'memory-dedup'])(
    'no longer schedules the retired %s cron',
    (name) => {
      expect(byPath(`/api/cron/${name}`)).toEqual([])
    },
  )

  it('has no duplicate paths', () => {
    const paths = crons.map((c) => c.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
