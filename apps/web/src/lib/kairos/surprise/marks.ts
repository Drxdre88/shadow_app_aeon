import { surpriseMarkSchema, type SurpriseMark, type SurpriseSignal } from '@/lib/data/validators/kairos-surprise'

// Surprise marks — the pure side (read a row's mark, decide open, compute the
// window) plus a best-effort opener. The data module (lib/data/surprise-marks)
// is imported lazily so these helpers never pull in the database client.

const HOUR = 3_600_000
const OPEN_HOUR_UTC = 7
const MIN_OPEN_MS = 12 * HOUR

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// The mark on a memory row, given its whole sourceMetadata. Tolerant: a
// missing or malformed mark is null (never throws).
export function readSurpriseMark(sourceMetadata: unknown): SurpriseMark | null {
  if (!isObj(sourceMetadata) || !isObj(sourceMetadata.engine)) return null
  const parsed = surpriseMarkSchema.safeParse(sourceMetadata.engine.surprise)
  return parsed.success ? parsed.data : null
}

// Open = the mark's openUntil is strictly after `now`.
export function isOpen(sourceMetadata: unknown, now: Date): boolean {
  const mark = readSurpriseMark(sourceMetadata)
  if (!mark) return false
  const until = Date.parse(mark.openUntil)
  return Number.isFinite(until) && until > now.getTime()
}

// The first 07:00Z at least 12h after `at` (UTC on purpose: the night engine
// window does not move with BST).
export function openUntilFor(at: Date): Date {
  const earliest = at.getTime() + MIN_OPEN_MS
  const d = new Date(earliest)
  let candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), OPEN_HOUR_UTC)
  if (candidate < earliest) candidate += 24 * HOUR
  return new Date(candidate)
}

// Best-effort: open `ids` with `signal` until openUntilFor(at). Never throws;
// returns the ids actually touched ([] on failure).
export async function openMemories(
  userId: string,
  ids: readonly string[],
  signal: Omit<SurpriseSignal, 'at'> & { at?: string },
  at: Date = new Date(),
): Promise<string[]> {
  if (ids.length === 0) return []
  try {
    const { openForUpdate } = await import('@/lib/data/surprise-marks')
    return await openForUpdate(userId, ids, { ...signal, at: signal.at ?? at.toISOString() }, openUntilFor(at))
  } catch (err) {
    console.error('[kairos:surprise] openMemories failed:', err)
    return []
  }
}
