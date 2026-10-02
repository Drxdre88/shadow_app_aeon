import { listTraceHistory } from '@/lib/data/recipes'
import { captureMemory } from '@/lib/data/memories'
import { deliverKairosSpeak } from './speak'

// ─────────────────────────────────────────────────────────────────────────
// Synthesis reliability (docs/kairos/31) — Part B: the health scorecard.
//
// Crons write streamClass:'trace' memories keyed by sourceMetadata.cronName:
//   - writeCronFailureTrace on a real failure — carries `reason`;
//   - writeCronSuccessTrace on a completed run — carries `outcome`
//     ('ok' | 'skipped', skipped = expected no-op that still proves the cron
//     fired) and deliberately NO `reason`; one row per cron/Dominion/UTC day.
// The recipe dispatcher (lib/kairos/dispatch.ts) additionally writes a trace
// per created run tagged sourceMetadata.recipe (no cronName, no outcome) —
// treated as an 'ok' row. Its failure path uses cronName `recipe:<NAME>`.
//
// Stage keys are normalised so one cron = one stage: `recipe:<NAME>` and
// recipe `<NAME>` collapse to the recipe name. (The BRIEF → 'briefer' alias
// went with the briefer cron in Kairos 0.17; retired crons simply stop
// writing traces and age out of the 48h window — never "missing".)
//
// Per stage per UTC night: 'failed' if any failure row, else 'ok' if any
// success row. A stage with no row on a night is "no signal" (absent from
// byStage) — never inferred 'ok'. A cron that has not yet adopted success
// traces therefore still shows only its failures.
//
// Exception — EXPECTED_NIGHTLY_STAGES (P3, docs/kairos/35): a stage that must
// leave a trace every night it is live. Once armed (seen for this user within
// EXPECTED_ARM_DAYS, carried forward in the rollup's `expectedStages`), a
// judged night with no row is marked 'failed' in byStage and listed in
// `missingStages`, so a tournament that never ran alarms like one that
// crashed. A night with 0 survivors still writes a success trace → 'ok'.
// ─────────────────────────────────────────────────────────────────────────

const WINDOW_HOURS = 48
// Generous: ~15 crons × Dominions × 2 nights of success + failure rows.
const HISTORY_CAP = 2000
export const SYNTHESIS_HEALTH_RECIPE = 'SYNTHESIS_HEALTH'

// Stages expected to trace every night once armed. 'idea-tournament' is the
// cronName of the trace the tournament writes when a night finishes or fails.
export const EXPECTED_NIGHTLY_STAGES: readonly string[] = ['idea-tournament']
// Disarm a stage not seen for this long (user lost the feature / key).
const EXPECTED_ARM_DAYS = 14
// Today's night is only judged missing from 08:00Z — after the tournament's
// latest possible finish. The rollup's own slot (04:25Z, so the 06:00 London
// message reads a same-day rollup) and any early manual run judge only last
// night, never a night still in flight.
const EXPECTED_JUDGE_TODAY_FROM_HOUR_UTC = 8
const DAY_MS = 24 * 60 * 60 * 1000

type StageStatus = 'ok' | 'failed'

export interface SynthesisHealthResult {
  date: string
  byStage: Record<string, Record<string, StageStatus>>
  alertedStages: string[]
  newlyAlertedStages: string[]
  // Expected stages with no trace on a judged night: stage → nights.
  missingStages: Record<string, string[]>
  memoryId: string
  created: boolean
}

// Carried forward in the rollup: when an expected stage was first armed and
// last seen (UTC dates).
export interface ExpectedStageState {
  since: string
  lastSeen: string
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

// cronName takes priority (every cron's failure/success trace uses it);
// recipe (dispatch.ts run traces) is the fallback. Both normalise to one key.
function stageKeyOf(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const cronName = metadata.cronName
  if (typeof cronName === 'string' && cronName) {
    return cronName.startsWith('recipe:') ? cronName.slice('recipe:'.length) : cronName
  }
  const recipe = metadata.recipe
  if (typeof recipe === 'string' && recipe) return recipe
  return null
}

function rowStatus(metadata: Record<string, unknown>): StageStatus | null {
  if (typeof metadata.reason === 'string' && metadata.reason) return 'failed'
  if (metadata.outcome === 'ok' || metadata.outcome === 'skipped') return 'ok'
  // Legacy dispatcher run trace: recipe-tagged, no cronName → a created run.
  if (typeof metadata.cronName !== 'string' && typeof metadata.recipe === 'string') return 'ok'
  return null
}

function extractAlertedStages(metadata: unknown): string[] {
  const raw = asRecord(metadata)?.alertedStages
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function extractExpectedStages(metadata: unknown): Record<string, ExpectedStageState> {
  const raw = asRecord(asRecord(metadata)?.expectedStages)
  const out: Record<string, ExpectedStageState> = {}
  if (!raw) return out
  for (const [stage, value] of Object.entries(raw)) {
    const rec = asRecord(value)
    const since = rec?.since
    const lastSeen = rec?.lastSeen
    if (typeof since === 'string' && ISO_DATE.test(since) && typeof lastSeen === 'string' && ISO_DATE.test(lastSeen)) {
      out[stage] = { since, lastSeen }
    }
  }
  return out
}

// Expected-stage nights the previous rollup judged missing.
function extractMissingStages(metadata: unknown): Record<string, string[]> {
  const raw = asRecord(asRecord(metadata)?.missingStages)
  const out: Record<string, string[]> = {}
  if (!raw) return out
  for (const [stage, nights] of Object.entries(raw)) {
    if (Array.isArray(nights)) out[stage] = nights.filter((n): n is string => typeof n === 'string' && ISO_DATE.test(n))
  }
  return out
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

// Mutates byStage: an armed expected stage with no row on a judged night is
// marked 'failed'. Returns the new carried state and the missing nights.
// Before EXPECTED_JUDGE_TODAY_FROM_HOUR_UTC (the normal 04:25Z slot) only last
// night is judged, so the night before is carried from the previous rollup's
// `missingStages` — unless a trace for it has since arrived — keeping "missing
// two nights running" a 2-strike. Tonight's run is never judged early, so a
// tournament still in flight cannot false-alarm.
function applyExpectedStages(
  byStage: Record<string, Record<string, StageStatus>>,
  previous: Record<string, ExpectedStageState>,
  now: Date,
  previousMissing: Record<string, string[]> = {},
): { expectedStages: Record<string, ExpectedStageState>; missingStages: Record<string, string[]> } {
  const today = utcDate(now)
  const yesterday = utcDate(new Date(now.getTime() - DAY_MS))
  const dayBefore = utcDate(new Date(now.getTime() - 2 * DAY_MS))
  const judged = now.getUTCHours() >= EXPECTED_JUDGE_TODAY_FROM_HOUR_UTC ? [yesterday, today] : [yesterday]

  const expectedStages: Record<string, ExpectedStageState> = {}
  const missingStages: Record<string, string[]> = {}
  for (const stage of EXPECTED_NIGHTLY_STAGES) {
    const seen = Object.keys(byStage[stage] ?? {}).sort()
    const prev = previous[stage]
    // A stage unseen for longer than the arm window starts a fresh arming.
    const prevLive = prev && daysBetween(prev.lastSeen, today) <= EXPECTED_ARM_DAYS ? prev : undefined
    const lastSeen = [prevLive?.lastSeen, seen.at(-1)].filter((d): d is string => !!d).sort().at(-1)
    const since = prevLive?.since ?? seen[0]
    if (!lastSeen || !since) continue
    expectedStages[stage] = { since, lastSeen }

    const carried = (previousMissing[stage] ?? []).filter((night) => night >= dayBefore && !judged.includes(night))
    for (const night of [...new Set([...carried, ...judged])].sort()) {
      if (night < since || night > today || byStage[stage]?.[night]) continue
      ;(byStage[stage] ??= {})[night] = 'failed'
      ;(missingStages[stage] ??= []).push(night)
    }
  }
  return { expectedStages, missingStages }
}

async function fireTwoStrikeAlert(stages: string[]): Promise<void> {
  const operatorUserId = process.env.KAIROS_OPERATOR_USER_ID
  if (!operatorUserId) {
    console.warn('[synthesis-health] KAIROS_OPERATOR_USER_ID unset — skipping 2-strike alert', { stages })
    return
  }
  try {
    await deliverKairosSpeak(operatorUserId, {
      title: 'Synthesis health alert',
      message: `${stages.length} synthesis stage(s) failed 2 consecutive nights: ${stages.join(', ')}.`,
      kind: 'notify',
      urgency: 'high',
      force: true,
      opsAlert: true,
      digest: false,
    })
  } catch (err) {
    // Best-effort — a broken alert must never block the rollup write below,
    // which is the durable record the housekeeping check reads.
    console.error('[synthesis-health] failed to deliver 2-strike alert', err)
  }
}

export async function computeSynthesisHealth(userId: string): Promise<SynthesisHealthResult> {
  const now = new Date()
  const today = utcDate(now)
  const cutoff = now.getTime() - WINDOW_HOURS * 60 * 60 * 1000

  const [previous, history] = await Promise.all([
    listTraceHistory(userId, { recipe: SYNTHESIS_HEALTH_RECIPE, limit: 1 }),
    listTraceHistory(userId, { since: new Date(cutoff), limit: HISTORY_CAP }),
  ])

  const prevAlertedStages = new Set(extractAlertedStages(previous[0]?.sourceMetadata))

  const byStage: Record<string, Record<string, StageStatus>> = {}
  for (const row of history) {
    if (row.createdAt.getTime() < cutoff) continue
    const metadata = asRecord(row.sourceMetadata)
    const stageKey = stageKeyOf(metadata)
    // Skip the rollup's own output — it must not become a "stage" of itself.
    if (!metadata || !stageKey || stageKey === SYNTHESIS_HEALTH_RECIPE) continue
    const status = rowStatus(metadata)
    if (!status) continue

    const night = utcDate(row.createdAt)
    const stageNights = byStage[stageKey] ?? (byStage[stageKey] = {})
    // A failure row for a stage-night always wins over an 'ok' seen the same
    // night (e.g. one Dominion failed while another succeeded).
    if (stageNights[night] !== 'failed') stageNights[night] = status
  }

  const { expectedStages, missingStages } = applyExpectedStages(
    byStage,
    extractExpectedStages(previous[0]?.sourceMetadata),
    now,
    extractMissingStages(previous[0]?.sourceMetadata),
  )

  const failingStages: string[] = []
  for (const [stageKey, nights] of Object.entries(byStage)) {
    const dates = Object.keys(nights).sort().reverse()
    if (dates.length >= 2 && nights[dates[0]] === 'failed' && nights[dates[1]] === 'failed') {
      failingStages.push(stageKey)
    }
  }
  failingStages.sort()

  const newlyAlertedStages = failingStages.filter((stage) => !prevAlertedStages.has(stage))
  if (newlyAlertedStages.length > 0) {
    await fireTwoStrikeAlert(newlyAlertedStages)
  }

  const { memory, created } = await captureMemory(userId, {
    type: 'session_event',
    streamClass: 'trace',
    source: 'system',
    title: `Synthesis health · ${today}`,
    bodyMd: JSON.stringify({ byStage, alertedStages: failingStages, missingStages }, null, 2),
    sourceMetadata: {
      externalId: `synthesis-health:${today}`,
      recipe: SYNTHESIS_HEALTH_RECIPE,
      byStage,
      alertedStages: failingStages,
      missingStages,
      expectedStages,
    },
  })

  return {
    date: today,
    byStage,
    alertedStages: failingStages,
    newlyAlertedStages,
    missingStages,
    memoryId: memory.id,
    created,
  }
}
