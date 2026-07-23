import { describe, it, expect } from 'vitest'
import { decodeDateOrNull } from '../sql-decoders'

// Regression for the 2026-07-23 ask-mine outage: MAX(timestamp) sql``
// fragments bypass Drizzle's column mapping and arrive as strings, so any
// consumer calling Date methods crashed with `.getTime is not a function`.
describe('decodeDateOrNull', () => {
  it('decodes the driver string form to a Date', () => {
    const decoded = decodeDateOrNull('2026-07-10 08:15:30.123+00')
    expect(decoded).toBeInstanceOf(Date)
    expect(decoded!.getTime()).toBe(Date.parse('2026-07-10T08:15:30.123Z'))
  })

  it('passes a Date through as a Date', () => {
    const date = new Date('2026-07-10T00:00:00.000Z')
    expect(decodeDateOrNull(date)!.getTime()).toBe(date.getTime())
  })

  it('keeps null (LEFT JOIN with no match) as null', () => {
    expect(decodeDateOrNull(null)).toBeNull()
  })
})
