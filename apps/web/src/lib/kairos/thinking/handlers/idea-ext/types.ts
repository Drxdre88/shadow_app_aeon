import type { IdeaEvidenceSnippet } from '@/lib/data/idea-inputs'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobRow } from '@/lib/kairos/engine/types'
import type { GroundedGenerate, IdeaGenerateInputs, IdeaParseOptions } from '@/lib/kairos/ideas/generate-prompt'
import type { IdeaJudgeContext, StoredCandidate } from '@/lib/kairos/ideas/judge-context'
import type { GroundedJudge } from '@/lib/kairos/ideas/judge-prompt'
import type { SelectionInput, SelectionResult } from '@/lib/kairos/ideas/select'
import type { IdeaCandidate, IdeaCritique, IdeaMeta, IdeaOutcome } from '@/lib/kairos/ideas/types'
import type { Origin } from '@/lib/kairos/origin'
import type { GenerateContext } from '../idea-generate-apply'
import type { TournamentRows } from '../idea-judge'

// Wave 3 idea-tournament extension seam. Every hook is optional; an extension
// that implements none is a no-op and flag-off output stays byte-identical.
// Hooks check their own flag and return their input unchanged when off.
// A throwing hook is logged and skipped; it never fails the job.

export type Awaitable<T> = T | Promise<T>

// Raw idea_generate job context (job.input.context), lane keys included.
export type JobContext = Readonly<Record<string, unknown>>

export interface GeneratePlanContext {
  userId: string
  now: Date
  day: string
  dominions: ReadonlyArray<{ id: string; name: string }>
  // Best-effort input failures; ends up in the job context's inputErrors.
  errors: string[]
}

export interface GeneratePlanDraft {
  system: string
  prompt: string
  validMemoryIds: string[]
  // Lanes add their own top-level keys (kept by the loose context schema).
  context: GenerateContext
}

export interface GenerateApplyScope {
  job: ThinkingJobRow
  jobContext: JobContext
  answeredBy: ThinkingAnsweredBy
  // Per-apply scratch shared between hooks of one apply; key it by lane name.
  scratch: Record<string, unknown>
}

export interface GenerateHookContext extends GenerateApplyScope {
  grounded: GroundedGenerate
}

export interface EnrichContext extends GenerateHookContext {
  // Live, non-idea evidence rows by id (cited + retrieved).
  evidence: ReadonlyMap<string, IdeaEvidenceSnippet>
}

// Returned by beforePlanJudge to hold tonight's judge back (e.g. a resample).
export interface JudgeDeferral {
  // Merged into the generate job's output instead of judgeContext/judgeJobId.
  output: Record<string, unknown>
}

export interface RecoveryContext {
  userId: string
  day: string
  // Recent idea_generate jobs, as planIdeaJudge listed them.
  jobs: readonly ThinkingJobRow[]
}

export interface JudgeApplyScope {
  job: ThinkingJobRow
  ctx: IdeaJudgeContext
  answeredBy: ThinkingAnsweredBy
  scratch: Record<string, unknown>
}

export interface TournamentWriteResult {
  written: boolean
  survivorIds: string[]
  archivedIds: string[]
}

export interface IdeaOutcomeEvent {
  userId: string
  memoryId: string
  // The proposal's sourceMetadata, read before the accept/dismiss mutated it.
  meta: Readonly<Record<string, unknown>>
  outcome: IdeaOutcome
  // Accept: the caller's origin (undefined = owner). Dismiss: operator inbox.
  origin: Origin | undefined
}

export interface IdeaExtension {
  // idea_generate plan: adjust inputs before the prompt is built (D novelty night).
  adjustGenerateInputs?(inputs: IdeaGenerateInputs, ctx: GeneratePlanContext): Awaitable<IdeaGenerateInputs>
  // idea_generate plan: system lines, spliceBeforeDataEnd sections, citable ids, context keys.
  planGenerate?(draft: GeneratePlanDraft, ctx: GeneratePlanContext & { inputs: IdeaGenerateInputs }): Awaitable<GeneratePlanDraft>

  // idea_generate apply: parse options from the plan-time job context; {} when off.
  parseOptions?(jobContext: JobContext): IdeaParseOptions
  // After parse, before embedding (B structure gate drops/annotates candidates).
  afterParse?(grounded: GroundedGenerate, scope: GenerateApplyScope): Awaitable<GroundedGenerate>
  // Per stored candidate (A tags, B bridge, C lens/likelihood, D move).
  enrichStoredCandidate?(stored: StoredCandidate, candidate: IdeaCandidate, ctx: EnrichContext): StoredCandidate
  // Final judge context (A Swiss round-1 pairs, atlas holders/challenges).
  buildJudgeContextExtras?(judge: IdeaJudgeContext, ctx: GenerateHookContext): Awaitable<IdeaJudgeContext>
  // Hold the judge back (C resample); the extension plans its own follow-up job.
  beforePlanJudge?(judge: IdeaJudgeContext, ctx: GenerateHookContext): Awaitable<JudgeDeferral | null>
  // Extra keys for the generate job output (B collision, C sameness).
  summarizeGenerate?(judge: IdeaJudgeContext, ctx: GenerateHookContext): Record<string, unknown> | null
  // Replace the paid fallback for a job this lane owns (C settles a resample).
  fallbackGenerate?(job: ThinkingJobRow): Awaitable<ApplyOutcome | null>
  // Settle a generate job the sweep gave up on (C settles a resample).
  abandonGenerate?(job: ThinkingJobRow, reason: string): Awaitable<string[] | null>

  // idea_judge recovery plan: a raw judge context to use instead of the base job's.
  pickRecoveryJudgeContext?(ctx: RecoveryContext): Awaitable<unknown>
  // Async prep before assembly (D reads the taste profile into scope.scratch).
  prepareJudge?(judged: GroundedJudge, scope: JudgeApplyScope): Awaitable<void>
  // Pure and sync, may run twice; one result per input, same order.
  postSelect?(selection: SelectionResult[], inputs: readonly SelectionInput[], scope: JudgeApplyScope): SelectionResult[]
  // Pure and sync, may run twice; extra IdeaMeta keys for one candidate.
  metaExtras?(candidate: StoredCandidate, selection: SelectionResult, critique: IdeaCritique | null, scope: JudgeApplyScope): Partial<IdeaMeta> | null
  // Extra body lines for a judged idea (B collision block, D note).
  composeExtraLines?(meta: IdeaMeta): string[]
  // After writeTournament (A atlas update).
  afterTournamentWrite?(result: TournamentWriteResult, rows: TournamentRows, scope: JudgeApplyScope): Awaitable<void>
  // Extra keys for the judge job's output.tournament summary.
  summarizeJudge?(rows: TournamentRows, scope: JudgeApplyScope): Record<string, unknown> | null

  // Triage: after the idea outcome is stamped (B bridge on owner accept, D outcomeBy).
  onIdeaOutcome?(event: IdeaOutcomeEvent): Awaitable<void>
}

export interface NamedIdeaExtension {
  readonly name: string
  readonly ext: IdeaExtension
}
