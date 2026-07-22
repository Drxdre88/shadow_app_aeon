import { listTraceHistory } from '@/lib/data/recipes'
import { captureMemory } from '@/lib/data/memories'
import { deliverKairosSpeak } from './speak'

// ─────────────────────────────────────────────────────────────────────────
// Synthesis reliability (docs/kairos/31) — Part B: the health scorecard.
//
// Every standard-tier generator (cortex, archetypes, introspection,
// contradiction) and every other nightly cron writes a streamClass:'trace'
// memory ONLY on failure (writeCronFailureTrace, sourceMetadata.cronName) —
// success is silent. The one exception is the recipe dispatcher
// (lib/kairos/dispatch.ts), which writes a trace on every run, tagged
// sourceMetadata.recipe (currently just 'BRIEF'). Both conventions coexist
// and are bucketed together here; normalising them is out of scope (phase 2).
//
// Because most stages are trace-on-failure-only, the absence of a row for a
// stage on a given UTC night is genuinely ambiguous — it could mean a clean
// run, or that the cron never fired at all. Liveness/heartbeat detection
// that would resolve that ambiguity is explicitly deferred to phase 2; this
// module reports "no signal", never "ok", for a night with no trace row.
// ─────────────────────────────────────────────────────────────────────────

const WINDOW_HOURS = 48
export const SYNTHESIS_HEALTH_RECIPE = 'SYNTHESIS_HEALTH'

type StageStatus = 'ok' | 'failed'

export interface SynthesisHealthResult {
  date: string
  byStage: Record<string, Record<string, StageStatus>>
  alertedStages: string[]
  newlyAlertedStages: string[]
  memoryId: string
  created: boolean
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

// The two coexisting conventions: cronName (writeCronFailureTrace) takes
// priority since it's the one every generator's failure path uses; recipe
// (dispatch.ts success traces) is the fallback.
function stageKeyOf(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const cronName = metadata.cronName
  if (typeof cronName === 'string' && cronName) return cronName
  const recipe = metadata.recipe
  if (typeof recipe === 'string' && recipe) return recipe
  return null
}

function isFailureRow(metadata: Record<string, unknown> | null): boolean {
  return Boolean(metadata && typeof metadata.reason === 'string' && metadata.reason)
}

function extractAlertedStages(metadata: unknown): string[] {
  const raw = asRecord(metadata)?.alertedStages
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
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
    listTraceHistory(userId, { limit: 200 }),
  ])

  const prevAlertedStages = new Set(extractAlertedStages(previous[0]?.sourceMetadata))

  const byStage: Record<string, Record<string, StageStatus>> = {}
  for (const row of history) {
    if (row.createdAt.getTime() < cutoff) continue
    const metadata = asRecord(row.sourceMetadata)
    const stageKey = stageKeyOf(metadata)
    // Skip the rollup's own output — it must not become a "stage" of itself.
    if (!stageKey || stageKey === SYNTHESIS_HEALTH_RECIPE) continue

    const night = utcDate(row.createdAt)
    const stageNights = byStage[stageKey] ?? (byStage[stageKey] = {})
    // A failure row for a stage-night always wins over an 'ok' seen the same
    // night (e.g. a recipe that both retried-and-succeeded and separately
    // threw once for another user's Dominion).
    if (stageNights[night] !== 'failed') {
      stageNights[night] = isFailureRow(metadata) ? 'failed' : 'ok'
    }
  }

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
    bodyMd: JSON.stringify({ byStage, alertedStages: failingStages }, null, 2),
    sourceMetadata: {
      externalId: `synthesis-health:${today}`,
      recipe: SYNTHESIS_HEALTH_RECIPE,
      byStage,
      alertedStages: failingStages,
    },
  })

  return {
    date: today,
    byStage,
    alertedStages: failingStages,
    newlyAlertedStages,
    memoryId: memory.id,
    created,
  }
}
