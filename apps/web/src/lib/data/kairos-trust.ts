import { askFirstMode } from '@/lib/kairos/advise/flag'
import { TRUST_WINDOW_DAYS, computeTrust } from '@/lib/kairos/trust/compute'
import { trustMode } from '@/lib/kairos/trust/flag'
import type { KairosTrustView, TrustInputs } from '@/lib/kairos/trust/types'
import { listGoalRecordsSince } from './goals'
import { listIdeaTasteRows } from './idea-taste'
import { listActiveDominions } from './idea-inputs'
import { readKairosPredictions } from './kairos-predictions'
import { readKairosPromises } from './kairos-promises'
import { readKairosSurprise } from './kairos-surprise'

// Earned trust per area (lane D): read-only, recomputed on every call from
// predictions, goals and goal-linked promises (ideas + corrections shown, not
// scored). A failed read is listed in `missing`, never fatal. Pure DB reads.

const DAY_MS = 86_400_000
// Goals close up to due (≤14 d) + timeout grace (7 d) after they are proposed.
const GOAL_LOOKBACK_EXTRA_DAYS = 30

async function safe<T>(name: string, missing: string[], fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    console.warn('[kairos:trust] read failed:', name, err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160))
    missing.push(name)
    return fallback
  }
}

const norm = (s: string) => s.trim().toLowerCase()

export async function readKairosTrust(
  userId: string,
  opts: { now?: Date; area?: string } = {},
): Promise<KairosTrustView> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - TRUST_WINDOW_DAYS * DAY_MS)
  const goalsSince = new Date(since.getTime() - GOAL_LOOKBACK_EXTRA_DAYS * DAY_MS)
  const missing: string[] = []
  const [predictions, promises, goals, ideaRows, dominions, surprise] = await Promise.all([
    safe('predictions', missing, [], async () => (await readKairosPredictions(userId)).closed),
    safe('promises', missing, [], async () => (await readKairosPromises(userId)).closed),
    safe('goals', missing, [], () => listGoalRecordsSince(userId, goalsSince)),
    safe('ideas', missing, [], () => listIdeaTasteRows(userId, since)),
    safe('dominions', missing, [], () => listActiveDominions(userId)),
    safe('corrections', missing, [], async () => (await readKairosSurprise(userId)).events),
  ])
  const inputs: TrustInputs = {
    predictions,
    promises,
    goals: goals.map((g) => ({ id: g.id, dominionId: g.dominionId, meta: g.meta })),
    ideaRows,
    surpriseEvents: surprise,
    dominionNames: new Map(dominions.map((d) => [d.id, d.name])),
  }
  const computed = computeTrust(inputs, now)
  const wanted = opts.area ? norm(opts.area) : null
  const areas = wanted
    ? computed.areas.filter((a) => norm(a.label) === wanted || norm(a.key) === wanted)
    : computed.areas
  return {
    ...computed,
    areas,
    mode: { trust: trustMode(), askFirst: askFirstMode() },
    generatedAt: now.toISOString(),
    missing: missing.sort(),
  }
}
