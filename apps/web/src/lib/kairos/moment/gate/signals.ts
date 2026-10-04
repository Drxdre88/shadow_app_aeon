import { signalsFromEntries, type GateSignals } from './break'

// Loads the break signals once: today-log entries (MCP `used` excluded) plus
// the owner's newest card close. lib/data is imported lazily (lane rule).

const HOUR_MS = 3_600_000

export async function loadGateSignals(userId: string, now: Date, awayMin: number): Promise<GateSignals> {
  const hours = Math.min(Math.max(Math.ceil(awayMin / 60) + 1, 1), 36)
  const [{ listTodayEntries, toKairosTodayView }, { findLatestOwnerCardClose }] = await Promise.all([
    import('@/lib/data/kairos-today'),
    import('@/lib/data/kairos-gate'),
  ])
  const [rows, cardClosedAt] = await Promise.all([
    listTodayEntries(userId, { hours, limit: 200, now, excludeTypes: ['used'] }),
    findLatestOwnerCardClose(userId, new Date(now.getTime() - hours * HOUR_MS)),
  ])
  return signalsFromEntries(rows.map(toKairosTodayView), cardClosedAt)
}
