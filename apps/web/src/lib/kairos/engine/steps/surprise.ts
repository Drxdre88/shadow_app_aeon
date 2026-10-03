import { findLatestConscienceRun } from '@/lib/data/constitution-drift'
import { clearSurprisePressure, listPressuredBeliefs, pruneSurpriseMarks } from '@/lib/data/surprise-gate'
import { loadSurpriseLedger } from '@/lib/kairos/surprise'
import { surpriseContradictionsOn, surpriseGateMode } from '@/lib/kairos/surprise/flag'
import { PRESSURE_OPEN_AT, PRESSURE_WINDOW_MS } from '@/lib/kairos/surprise/gate'
import { recordSurprise, surpriseKeySeen } from '@/lib/kairos/surprise/ledger'
import { openMemories } from '@/lib/kairos/surprise/marks'
import { errorMessage, outOfTime } from '../deadline'
import type { EngineRunContext, Step, StepResult } from '../types'

// Surprise (spec_surprise Lane 1), between Weigh and OwnMind: the night's
// upkeep of surprise marks. Behind KAIROS_SURPRISE_GATE (off → skipped).
//  1. contradictions (KAIROS_SURPRISE_CONTRADICTIONS only — it reverses the
//     conscience "measurement only" invariant): pairs the latest conscience
//     run found contradicting open both beliefs (s .5), once per run+pair;
//  2. pressure valve: a held aligned belief whose gated replaces reached 2
//     within 14 days, not open and not operator-defended, opens (s .4) and
//     its pressure resets;
//  3. prune: mark signals (and pressure) older than 14 days are dropped.
// Marks are not memory_ops rows (the surprise ledger is the audit trail);
// a dry run reads nothing and writes nothing.

export const SURPRISE_STEP = 'surprise'
export const SURPRISE_BUDGET_MS = 10_000
export const CONTRADICTION_S = 0.5
export const PRESSURE_S = 0.4
// A conscience run older than this is not acted on (its pairs are stale).
export const CONTRADICTION_MAX_AGE_MS = 2 * 86_400_000
const PRESSURE_BATCH = 20

export interface SurpriseStepDeps {
  latestConscience?: typeof findLatestConscienceRun
  pressured?: typeof listPressuredBeliefs
  clearPressure?: typeof clearSurprisePressure
  prune?: typeof pruneSurpriseMarks
  open?: typeof openMemories
  record?: typeof recordSurprise
  ledger?: typeof loadSurpriseLedger
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// Pure: the contradiction pairs stored on a drift_run's conscience section.
export function contradictionPairs(sourceMetadata: unknown): Array<[string, string]> {
  if (!isObj(sourceMetadata) || !isObj(sourceMetadata.conscience)) return []
  const c = sourceMetadata.conscience.contradictions
  if (!isObj(c) || !Array.isArray(c.ids)) return []
  return c.ids.flatMap((p) =>
    Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string' && p[0] !== p[1] ? [[p[0], p[1]] as [string, string]] : [])
}

export class SurpriseStep implements Step {
  readonly name = SURPRISE_STEP
  readonly budgetMs = SURPRISE_BUDGET_MS

  constructor(private readonly deps: SurpriseStepDeps = {}) {}

  async run(ctx: EngineRunContext): Promise<StepResult> {
    if (surpriseGateMode() === 'off') return { step: this.name, examined: 0, changed: 0, skipped: 'KAIROS_SURPRISE_GATE off' }
    if (ctx.dryRun) return { step: this.name, examined: 0, changed: 0, notes: ['dry run: marks untouched'] }
    const open = this.deps.open ?? openMemories
    const errors: string[] = []
    const tally = { contradictions: 0, pressure: 0, pruned: 0 }
    let examined = 0
    let stopped = false

    if (surpriseContradictionsOn() && !outOfTime(ctx)) {
      try {
        const run = await (this.deps.latestConscience ?? findLatestConscienceRun)(ctx.userId)
        if (run && ctx.now.getTime() - run.createdAt.getTime() <= CONTRADICTION_MAX_AGE_MS) {
          const pairs = contradictionPairs(run.sourceMetadata)
          examined += pairs.length
          const record = this.deps.record ?? recordSurprise
          const ledger = pairs.length ? await (this.deps.ledger ?? loadSurpriseLedger)(ctx.userId) : null
          for (const [a, b] of pairs) {
            if (outOfTime(ctx)) {
              stopped = true
              break
            }
            const key = `contradiction:${run.id}:${a}:${b}`
            if (ledger && surpriseKeySeen(ledger, key)) continue
            const opened = await open(ctx.userId, [a, b], { kind: 'contradiction', ref: run.id, s: CONTRADICTION_S }, ctx.now)
            await record(ctx.userId, {
              key,
              kind: 'contradiction',
              s: CONTRADICTION_S,
              refs: { beliefIds: [a, b], memoryIds: [run.id] },
              opened,
            }, { now: ctx.now })
            if (opened.length) tally.contradictions++
          }
        }
      } catch (err) {
        errors.push(`contradictions: ${errorMessage(err)}`)
      }
    }

    if (!stopped && !outOfTime(ctx)) {
      try {
        const ids = await (this.deps.pressured ?? listPressuredBeliefs)(ctx.userId, ctx.now, { min: PRESSURE_OPEN_AT, windowMs: PRESSURE_WINDOW_MS, limit: PRESSURE_BATCH })
        examined += ids.length
        for (const id of ids) {
          if (outOfTime(ctx)) {
            stopped = true
            break
          }
          const opened = await open(ctx.userId, [id], { kind: 'pressure', ref: id, s: PRESSURE_S }, ctx.now)
          if (opened.length === 0) continue
          await (this.deps.clearPressure ?? clearSurprisePressure)(ctx.userId, opened)
          tally.pressure++
        }
      } catch (err) {
        errors.push(`pressure: ${errorMessage(err)}`)
      }
    } else stopped = true

    if (!stopped && !outOfTime(ctx)) {
      try {
        tally.pruned = await (this.deps.prune ?? pruneSurpriseMarks)(ctx.userId, ctx.now, PRESSURE_WINDOW_MS)
      } catch (err) {
        errors.push(`prune: ${errorMessage(err)}`)
      }
    } else stopped = true

    const notes = [
      `contradictions_opened=${tally.contradictions}`,
      `pressure_opened=${tally.pressure}`,
      `pruned=${tally.pruned}`,
      errors.length ? `failed=${errors.length}` : null,
      stopped ? 'out of time' : null,
    ].filter((n): n is string => n !== null)
    return {
      step: this.name,
      examined,
      changed: tally.contradictions + tally.pressure + tally.pruned,
      notes,
      opsWritten: 0,
      ...(errors.length ? { errors } : {}),
      ...(stopped ? { outOfTime: true } : {}),
    }
  }
}
