import type { AetherReplayRow, PriorAetherRow } from '@/lib/kairos/aether-prompt'
import type { CortexDueSoonRow } from '@/lib/kairos/cortex-prompt'
import { surpriseReplayMode, type SurpriseMode } from './flag'
import {
  REPLAY_STREAK_NIGHTS,
  applyBeliefHop,
  applyReplayNight,
  collectReplayNeeds,
  inhibitedIds,
  replayNote,
  scoreReplay,
  topReplay,
  topReplayForDominion,
  type ReplayCandidate,
  type ReplaySources,
} from './replay'

// ─────────────────────────────────────────────────────────────────────────
// Replay — the I/O half (KAIROS_SURPRISE_REPLAY 0|observe|1). Never throws:
// any failure means "no replay tonight" and the syntheses run exactly as
// before. Off → nothing is read. Observe → computed and stored (ledger +
// aether row), never rendered. On → also rendered into the prompts.
// DB modules are imported lazily so importing this never pulls the client.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const log = (what: string, err: unknown) => console.error(`[kairos:surprise] replay ${what} failed:`, err)

function quiet<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  return p.catch((err) => {
    log(`${label} read`, err)
    return fallback
  })
}

async function readReplaySources(userId: string, now: Date): Promise<ReplaySources> {
  const [agenda, predictions, promises, goals] = await Promise.all([
    import('@/lib/data/kairos-agenda'),
    import('@/lib/data/kairos-predictions'),
    import('@/lib/data/kairos-promises'),
    import('@/lib/data/goals'),
  ])
  const [a, p, pr, g] = await Promise.all([
    quiet(agenda.readKairosAgenda(userId).then((s) => s.open), [], 'agenda'),
    quiet(predictions.readKairosPredictions(userId).then((s) => s.open), [], 'predictions'),
    quiet(promises.readKairosPromises(userId).then((s) => s.open), [], 'promises'),
    quiet(goals.listOpenGoals(userId, now), [], 'goals'),
  ])
  return {
    agenda: a,
    predictions: p,
    promises: pr,
    goals: g.map((x) => ({ id: x.id, dominionId: x.dominionId, seedIds: x.meta.seeds.map((s) => s.id) })),
  }
}

// Every scored candidate, best first ([] when nothing is due).
async function scoreAll(userId: string, now: Date): Promise<ReplayCandidate[]> {
  const direct = collectReplayNeeds(await readReplaySources(userId, now), now)
  if (direct.size === 0) return []
  const { listReplayCiters, listReplayRows, listRecentReplaySets } = await import('@/lib/data/replay-candidates')
  const needs = applyBeliefHop(direct, await listReplayCiters(userId, [...direct.keys()]))
  const rows = await listReplayRows(userId, [...needs.keys()], now)
  const since = new Date(now.getTime() - REPLAY_STREAK_NIGHTS * DAY_MS)
  const history = await quiet(listRecentReplaySets(userId, since, REPLAY_STREAK_NIGHTS - 1), [], 'history')
  return scoreReplay({ needs, rows, now, inhibited: inhibitedIds(history) })
}

export interface AetherReplayPlan {
  mode: Exclude<SurpriseMode, 'off'>
  night: string
  ids: string[]
  items: AetherReplayRow[]
}

export const toAetherReplayRow = (c: ReplayCandidate): AetherReplayRow => ({
  id: c.id,
  title: c.title,
  summary: c.summary,
  note: replayNote(c),
})

// The replay set stored on the aether row (sourceMetadata.surpriseReplay —
// feeds the 3-nights inhibition). {} without a plan, so the row is unchanged.
export function replayMetadata(replay: { ids: readonly string[] } | null | undefined): Record<string, unknown> {
  return replay ? { surpriseReplay: { ids: [...replay.ids] } } : {}
}

// Replay ids a queued aether job carried from plan to apply (context.replayIds).
export function replayIdsOf(context: Record<string, unknown> | undefined): { ids: string[] } | null {
  const ids = context?.replayIds
  return Array.isArray(ids) ? { ids: ids.filter((x): x is string => typeof x === 'string') } : null
}

// Tonight's global replay set (top 8) for the aether, plus the ledger's
// replay block (idempotent per UTC night; prevHits from the prior aether's
// citations). null when off, empty or on failure.
export async function loadAetherReplay(
  userId: string,
  now: Date,
  prior: Pick<PriorAetherRow, 'payload'> | null,
): Promise<AetherReplayPlan | null> {
  const mode = surpriseReplayMode()
  if (mode === 'off') return null
  try {
    const top = topReplay(await scoreAll(userId, now))
    const night = now.toISOString().slice(0, 10)
    const ids = top.map((c) => c.id)
    const cited = (prior?.payload?.thoughts ?? []).flatMap((t) => t.sourceMemoryIds)
    try {
      const { mutateKairosSurprise } = await import('@/lib/data/kairos-surprise')
      await mutateKairosSurprise(userId, (l) => applyReplayNight(l, { night, ids, cited }), now)
    } catch (err) {
      log('ledger write', err)
    }
    if (top.length === 0) return null
    return { mode, night, ids, items: top.map(toAetherReplayRow) }
  } catch (err) {
    log('loadAetherReplay', err)
    return null
  }
}

// Render-only "Due soon in this area" rows for one Dominion's cortex (top 4,
// no ids). {} unless the flag is on, so the spread is a no-op otherwise.
export async function cortexDueSoonContext(
  userId: string,
  dominionId: string,
  now: Date = new Date(),
): Promise<{ dueSoon?: CortexDueSoonRow[] }> {
  if (surpriseReplayMode() !== 'on') return {}
  try {
    const rows = topReplayForDominion(await scoreAll(userId, now), dominionId)
    return rows.length ? { dueSoon: rows.map((c) => ({ title: c.title, note: replayNote(c) })) } : {}
  } catch (err) {
    log('cortexDueSoonContext', err)
    return {}
  }
}
