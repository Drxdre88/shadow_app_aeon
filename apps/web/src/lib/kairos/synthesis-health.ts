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
// recipe `<NAME>` collapse to the recipe name, and RECIPE_STAGE_ALIASES maps
// a recipe to the cron that drives it (BRIEF → 'briefer', so the briefer
// route's own failure/success rows land on the same stage).
//
// Per stage per UTC night: 'failed' if any failure row, else 'ok' if any
// success row. A stage with no row on a night is "no signal" (absent from
// byStage) — never inferred 'ok'. A cron that has not yet adopted success
// traces therefore still shows only its failures.
// ─────────────────────────────────────────────────────────────────────────

const WINDOW_HOURS = 48
// Generous: ~15 crons × Dominions × 2 nights of success + failure rows.
const HISTORY_CAP = 2000
export const SYNTHESIS_HEALTH_RECIPE = 'SYNTHESIS_HEALTH'

const RECIPE_STAGE_ALIASES: Record<string, string> = {
  BRIEF: 'briefer',
}

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

function recipeStage(recipe: string): string {
  return RECIPE_STAGE_ALIASES[recipe] ?? recipe
}

// cronName takes priority (every cron's failure/success trace uses it);
// recipe (dispatch.ts run traces) is the fallback. Both normalise to one key.
function stageKeyOf(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const cronName = metadata.cronName
  if (typeof cronName === 'string' && cronName) {
    return cronName.startsWith('recipe:') ? recipeStage(cronName.slice('recipe:'.length)) : cronName
  }
  const recipe = metadata.recipe
  if (typeof recipe === 'string' && recipe) return recipeStage(recipe)
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
