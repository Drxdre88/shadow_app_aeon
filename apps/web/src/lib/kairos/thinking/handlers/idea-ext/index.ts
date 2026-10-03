import type { ApplyOutcome, ThinkingJobRow } from '@/lib/kairos/engine/types'
import type { GroundedGenerate, IdeaGenerateInputs, IdeaParseOptions } from '@/lib/kairos/ideas/generate-prompt'
import type { IdeaJudgeContext, StoredCandidate } from '@/lib/kairos/ideas/judge-context'
import type { GroundedJudge } from '@/lib/kairos/ideas/judge-prompt'
import { eliminationReason, type SelectionInput, type SelectionResult } from '@/lib/kairos/ideas/select'
import { IDEA_SURVIVORS_MAX, type IdeaCandidate, type IdeaCritique, type IdeaMeta } from '@/lib/kairos/ideas/types'
import type { TournamentRows } from '../idea-judge'
import { errorReason } from '../_errors'
import { atlasExtension } from './atlas'
import { collisionExtension } from './collision'
import { samenessExtension } from './sameness'
import { steppingExtension } from './stepping'
import type {
  EnrichContext,
  GenerateApplyScope,
  GenerateHookContext,
  GeneratePlanContext,
  GeneratePlanDraft,
  IdeaOutcomeEvent,
  JobContext,
  JudgeApplyScope,
  JudgeDeferral,
  NamedIdeaExtension,
  RecoveryContext,
  TournamentWriteResult,
} from './types'

export type * from './types'

// Fixed order: stepping first so a novelty night can override atlas targeting.
export const IDEA_EXTENSIONS: readonly NamedIdeaExtension[] = [
  { name: 'stepping', ext: steppingExtension },
  { name: 'atlas', ext: atlasExtension },
  { name: 'collision', ext: collisionExtension },
  { name: 'sameness', ext: samenessExtension },
]

type Exts = readonly NamedIdeaExtension[]

function report(name: string, hook: string, err: unknown): string {
  const reason = `ext:${name}.${hook}: ${errorReason(err)}`.slice(0, 200)
  console.warn('[kairos:idea-ext] hook failed:', reason)
  return reason
}

function guard<T>(name: string, hook: string, fallback: T, run: () => T): T {
  try {
    return run()
  } catch (err) {
    report(name, hook, err)
    return fallback
  }
}

async function guardAsync<T>(name: string, hook: string, fallback: T, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    report(name, hook, err)
    return fallback
  }
}

export const jobContextOf = (job: ThinkingJobRow): JobContext =>
  (job.input?.context && typeof job.input.context === 'object' ? job.input.context : {}) as JobContext

// ── idea_generate plan ────────────────────────────────────────────────────

export async function runAdjustGenerateInputs(inputs: IdeaGenerateInputs, ctx: GeneratePlanContext, exts: Exts = IDEA_EXTENSIONS): Promise<IdeaGenerateInputs> {
  let out = inputs
  for (const { name, ext } of exts) {
    if (!ext.adjustGenerateInputs) continue
    const before = out
    out = await guardAsync(name, 'adjustGenerateInputs', before, () => ext.adjustGenerateInputs!(before, ctx))
  }
  return out
}

export async function runPlanGenerate(
  draft: GeneratePlanDraft,
  ctx: GeneratePlanContext & { inputs: IdeaGenerateInputs },
  exts: Exts = IDEA_EXTENSIONS,
): Promise<GeneratePlanDraft> {
  let out = draft
  for (const { name, ext } of exts) {
    if (!ext.planGenerate) continue
    const before = out
    try {
      out = await ext.planGenerate(before, ctx)
    } catch (err) {
      ctx.errors.push(report(name, 'planGenerate', err))
      out = before
    }
  }
  return out
}

// ── idea_generate apply ───────────────────────────────────────────────────

// Merged parse options, or undefined when no lane asked for any (unchanged parse).
export function runParseOptions(jobContext: JobContext, exts: Exts = IDEA_EXTENSIONS): IdeaParseOptions | undefined {
  const parts: Array<{ name: string; opts: IdeaParseOptions }> = []
  for (const { name, ext } of exts) {
    if (!ext.parseOptions) continue
    const opts = guard(name, 'parseOptions', {} as IdeaParseOptions, () => ext.parseOptions!(jobContext))
    if (opts && Object.keys(opts).length > 0) parts.push({ name, opts })
  }
  if (parts.length === 0) return undefined
  const extenders = parts.filter((p) => p.opts.extendCandidate)
  const posts = parts.filter((p) => p.opts.postProcess)
  const merged: IdeaParseOptions = {}
  if (extenders.length) {
    merged.extendCandidate = (rawItem, built, direction) => extenders.reduce<IdeaCandidate>(
      (acc, p) => guard(p.name, 'extendCandidate', acc, () => p.opts.extendCandidate!(rawItem, acc, direction)), built)
  }
  if (posts.length) {
    merged.postProcess = (cands, info) => posts.reduce<IdeaCandidate[]>(
      (acc, p) => guard(p.name, 'postProcess', acc, () => p.opts.postProcess!(acc, info)), cands)
  }
  if (parts.some((p) => p.opts.skipCap)) merged.skipCap = true
  if (parts.some((p) => p.opts.keepRaw)) merged.keepRaw = true
  return merged
}

export async function runAfterParse(grounded: GroundedGenerate, scope: GenerateApplyScope, exts: Exts = IDEA_EXTENSIONS): Promise<GroundedGenerate> {
  let out = grounded
  for (const { name, ext } of exts) {
    if (!ext.afterParse) continue
    const before = out
    out = await guardAsync(name, 'afterParse', before, () => ext.afterParse!(before, scope))
  }
  return out
}

export function runEnrichStoredCandidate(stored: StoredCandidate, candidate: IdeaCandidate, ctx: EnrichContext, exts: Exts = IDEA_EXTENSIONS): StoredCandidate {
  let out = stored
  for (const { name, ext } of exts) {
    if (!ext.enrichStoredCandidate) continue
    const before = out
    out = guard(name, 'enrichStoredCandidate', before, () => ext.enrichStoredCandidate!(before, candidate, ctx))
  }
  return out
}

export async function runBuildJudgeContextExtras(judge: IdeaJudgeContext, ctx: GenerateHookContext, exts: Exts = IDEA_EXTENSIONS): Promise<IdeaJudgeContext> {
  let out = judge
  for (const { name, ext } of exts) {
    if (!ext.buildJudgeContextExtras) continue
    const before = out
    out = await guardAsync(name, 'buildJudgeContextExtras', before, () => ext.buildJudgeContextExtras!(before, ctx))
  }
  return out
}

// First lane to defer wins.
export async function runBeforePlanJudge(judge: IdeaJudgeContext, ctx: GenerateHookContext, exts: Exts = IDEA_EXTENSIONS): Promise<JudgeDeferral | null> {
  for (const { name, ext } of exts) {
    if (!ext.beforePlanJudge) continue
    const deferral = await guardAsync(name, 'beforePlanJudge', null, () => ext.beforePlanJudge!(judge, ctx))
    if (deferral) return deferral
  }
  return null
}

export function runSummarizeGenerate(judge: IdeaJudgeContext, ctx: GenerateHookContext, exts: Exts = IDEA_EXTENSIONS): Record<string, unknown> {
  let out: Record<string, unknown> = {}
  for (const { name, ext } of exts) {
    if (!ext.summarizeGenerate) continue
    const extra = guard(name, 'summarizeGenerate', null, () => ext.summarizeGenerate!(judge, ctx))
    if (extra) out = { ...out, ...extra }
  }
  return out
}

export async function runFallbackGenerate(job: ThinkingJobRow, exts: Exts = IDEA_EXTENSIONS): Promise<ApplyOutcome | null> {
  for (const { name, ext } of exts) {
    if (!ext.fallbackGenerate) continue
    const outcome = await guardAsync(name, 'fallbackGenerate', null, () => ext.fallbackGenerate!(job))
    if (outcome) return outcome
  }
  return null
}

export async function runAbandonGenerate(job: ThinkingJobRow, reason: string, exts: Exts = IDEA_EXTENSIONS): Promise<string[] | null> {
  for (const { name, ext } of exts) {
    if (!ext.abandonGenerate) continue
    const ids = await guardAsync(name, 'abandonGenerate', null, () => ext.abandonGenerate!(job, reason))
    if (ids) return ids
  }
  return null
}

// ── idea_judge ────────────────────────────────────────────────────────────

// undefined = no lane picked one; use the base generate job's judgeContext.
export async function runPickRecoveryJudgeContext(ctx: RecoveryContext, exts: Exts = IDEA_EXTENSIONS): Promise<unknown> {
  for (const { name, ext } of exts) {
    if (!ext.pickRecoveryJudgeContext) continue
    const picked = await guardAsync<unknown>(name, 'pickRecoveryJudgeContext', undefined, () => ext.pickRecoveryJudgeContext!(ctx))
    if (picked !== undefined) return picked
  }
  return undefined
}

export async function runPrepareJudge(judged: GroundedJudge, scope: JudgeApplyScope, exts: Exts = IDEA_EXTENSIONS): Promise<void> {
  for (const { name, ext } of exts) {
    if (ext.prepareJudge) await guardAsync(name, 'prepareJudge', undefined, () => ext.prepareJudge!(judged, scope))
  }
}

const sameShape = (a: readonly SelectionResult[], b: readonly SelectionResult[]) =>
  Array.isArray(b) && a.length === b.length && a.every((s, i) => b[i]?.key === s.key)

// An extension may re-pick among gated candidates, never past a hard gate,
// beyond the survivor cap, or with clashing ranks.
function validSelection(next: readonly SelectionResult[], inputs: readonly SelectionInput[]): boolean {
  const byKey = new Map(inputs.map((c) => [c.key, c]))
  const survivors = next.filter((s) => s.status === 'survivor')
  if (survivors.length > IDEA_SURVIVORS_MAX) return false
  if (survivors.some((s) => { const c = byKey.get(s.key); return !c || eliminationReason(c) !== null })) return false
  const ranks = next.map((s) => s.rank).filter((r): r is number => r !== null)
  return new Set(ranks).size === ranks.length
}

export function runPostSelect(selection: SelectionResult[], inputs: readonly SelectionInput[], scope: JudgeApplyScope, exts: Exts = IDEA_EXTENSIONS): SelectionResult[] {
  let out = selection
  for (const { name, ext } of exts) {
    if (!ext.postSelect) continue
    const before = out
    const next = guard(name, 'postSelect', before, () => ext.postSelect!(before, inputs, scope))
    if (sameShape(before, next) && validSelection(next, inputs)) out = next
    else report(name, 'postSelect', new Error('result does not match the selection order or breaks a selection rule'))
  }
  return out
}

// Core tournament fields stay owned by the judge; extensions only add keys.
const CORE_META_KEYS = new Set(['v', 'key', 'status', 'rank', 'eliminatedReason', 'outcome', 'outcomeAt', 'tournamentDate'])

export function runMetaExtras(
  candidate: StoredCandidate,
  selection: SelectionResult,
  critique: IdeaCritique | null,
  scope: JudgeApplyScope,
  exts: Exts = IDEA_EXTENSIONS,
): Partial<IdeaMeta> {
  let out: Partial<IdeaMeta> = {}
  for (const { name, ext } of exts) {
    if (!ext.metaExtras) continue
    const extra = guard(name, 'metaExtras', null, () => ext.metaExtras!(candidate, selection, critique, scope))
    if (extra) {
      const safe = Object.fromEntries(Object.entries(extra).filter(([k]) => !CORE_META_KEYS.has(k))) as Partial<IdeaMeta>
      out = { ...out, ...safe }
    }
  }
  return out
}

export function runComposeExtraLines(meta: IdeaMeta, exts: Exts = IDEA_EXTENSIONS): string[] {
  const out: string[] = []
  for (const { name, ext } of exts) {
    if (!ext.composeExtraLines) continue
    out.push(...guard<string[]>(name, 'composeExtraLines', [], () => ext.composeExtraLines!(meta)))
  }
  return out
}

export async function runAfterTournamentWrite(result: TournamentWriteResult, rows: TournamentRows, scope: JudgeApplyScope, exts: Exts = IDEA_EXTENSIONS): Promise<void> {
  for (const { name, ext } of exts) {
    if (ext.afterTournamentWrite) await guardAsync(name, 'afterTournamentWrite', undefined, () => ext.afterTournamentWrite!(result, rows, scope))
  }
}

export function runSummarizeJudge(rows: TournamentRows, scope: JudgeApplyScope, exts: Exts = IDEA_EXTENSIONS): Record<string, unknown> {
  let out: Record<string, unknown> = {}
  for (const { name, ext } of exts) {
    if (!ext.summarizeJudge) continue
    const extra = guard(name, 'summarizeJudge', null, () => ext.summarizeJudge!(rows, scope))
    if (extra) out = { ...out, ...extra }
  }
  return out
}

// ── triage ────────────────────────────────────────────────────────────────

export async function runOnIdeaOutcome(event: IdeaOutcomeEvent, exts: Exts = IDEA_EXTENSIONS): Promise<void> {
  for (const { name, ext } of exts) {
    if (ext.onIdeaOutcome) await guardAsync(name, 'onIdeaOutcome', undefined, () => ext.onIdeaOutcome!(event))
  }
}
