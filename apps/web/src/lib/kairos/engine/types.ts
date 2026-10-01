// Shared contract for the Kairos memory engine (docs/kairos/32-memory-engine.md).
// Parent-owned: lanes implement against these types and must not change them.

export interface EngineLink {
  type: string
  target: string
  target_kind: string
}

export interface EngineMemory {
  id: string
  userId: string
  dominionId: string | null
  type: string
  streamClass: string
  source: string
  confidence: number | null
  standing: number | null
  pinned: boolean
  createdAt: Date
  validAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
  useCount: number
  supersededAt: Date | null
  invalidAt: Date | null
  archivedAt: Date | null
  sourceMetadata: Record<string, unknown>
  links: EngineLink[]
  tags: string[]
}

export interface SupportSummary {
  independentSupports: number
  distinctDays: number
  // P2.5: supports whose origin is the operator or their recorded activity
  // (lib/kairos/origin.ts). Promotion needs at least one, so Kairos can't be
  // backed up only by AI-written material. Absent on pre-P2.5 summaries.
  anchoredSupports?: number
}

export interface OutcomeSummary {
  positive: number
  negative: number
}

export interface ScoreContext {
  now: Date
  support?: SupportSummary
  outcome?: OutcomeSummary
  openChallenges?: number
}

export interface ScorerResult {
  name: string
  factor: number
  note?: string
}

export interface Scorer {
  readonly name: string
  score(memory: EngineMemory, ctx: ScoreContext): ScorerResult
}

export interface StandingBreakdown {
  standing: number
  base: number
  factors: ScorerResult[]
}

export type MemoryOpKind =
  | 'score'
  | 'promote'
  | 'decay'
  | 'reject'
  | 'merge'
  | 'concept_create'
  | 'concept_update'
  | 'feedback'
  | 'revert'
  // P2.5 belief re-check cascade: a belief lost support and awaits re-examination.
  | 'recheck'
  // P2.5: a belief retired after re-examination.
  | 'retire'

export interface MemoryOpInput {
  memoryId: string | null
  step: string
  op: MemoryOpKind
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason: string
}

// Dry-run report of the ops a run WOULD write. Live steps never record here:
// they write each op in the same transaction as the mutation it describes
// (docs/kairos/32 §2), so a killed function can never strand a write without
// its trail.
export interface ChangeLog {
  readonly runId: string
  record(op: MemoryOpInput): void
  pending(): readonly MemoryOpInput[]
  flush(): Promise<number>
}

export interface EngineRunContext {
  userId: string
  runId: string
  now: Date
  dryRun: boolean
  changes: ChangeLog
  // Wall-clock budget (epoch ms). Past it, steps start no new mutations so the
  // cron can still write its trace before the platform kills the function.
  deadline?: number
}

export interface StepResult {
  step: string
  examined: number
  changed: number
  skipped?: string
  notes?: string[]
  // Live runs: memory_ops rows written (each inside its mutation's transaction).
  opsWritten?: number
  // Per-mutation failures; each one was rolled back together with its op.
  errors?: string[]
  // The step stopped early because the run's deadline passed.
  outOfTime?: boolean
}

export interface Step {
  readonly name: string
  run(ctx: EngineRunContext): Promise<StepResult>
}

export interface EngineRunResult {
  runId: string
  userId: string
  dryRun: boolean
  steps: StepResult[]
  opsWritten: number
  // Dry runs: ops the run would have written.
  opsPlanned?: number
  // Some step was cut short (or skipped) by the deadline.
  outOfTime?: boolean
  failedSteps: Array<{ step: string; error: string }>
}

// ── Thinking queue ────────────────────────────────────────────────────────

export type ThinkingJobKind =
  | 'aether'
  | 'cortex'
  | 'concept'
  // P2 (docs/kairos/34)
  | 'belief_extract'
  | 'drift_probe'
  | 'mind_compare'
  | 'weekly_review'
  | 'daily_message'
  | 'chat'
  // P3 Creativity (docs/kairos/35): nightly idea tournament, two stages.
  | 'idea_generate'
  | 'idea_judge'
  // All-on-Max (docs/kairos/33 §Kinds): the former paid-key crons. Each
  // cron stays as its kind's fallback and skips work a routine completed.
  | 'chat_distill'
  | 'archetype'
  | 'ask_mine'
  | 'contradiction'
  | 'brief'
  | 'introspection'
  | 'micro_consolidate'

export type ThinkingJobStatus = 'queued' | 'claimed' | 'done' | 'failed' | 'expired' | 'fallback'

export type ThinkingAnsweredBy = 'routine' | 'api' | 'deterministic'

export interface ThinkingJobInput {
  system: string
  prompt: string
  // Ids the model may cite; handlers ground against them.
  validMemoryIds?: string[]
  // Kind-specific state the handler needs to apply the output.
  context?: Record<string, unknown>
  maxOutputTokens?: number
}

export interface ThinkingJobSpec {
  kind: ThinkingJobKind
  dominionId: string | null
  externalKey: string
  deadlineMinutes: number
  input: ThinkingJobInput
}

export interface ThinkingJobRow {
  id: string
  userId: string
  kind: ThinkingJobKind
  dominionId: string | null
  externalKey: string
  status: ThinkingJobStatus
  input: ThinkingJobInput
  output: Record<string, unknown> | null
  claimedBy: ThinkingAnsweredBy | null
  claimToken: string | null
  claimedAt: Date | null
  deadlineAt: Date
  completedAt: Date | null
  attempts: number
  error: string | null
  createdAt: Date
  updatedAt: Date
}

export type ApplyOutcome =
  // `output` is merged into the completed job's output (e.g. a draft the cron delivers later).
  | { ok: true; memoryIds: string[]; output?: Record<string, unknown> }
  | { ok: false; reason: string }

export interface ThinkingJobHandler {
  readonly kind: ThinkingJobKind
  // Build zero or more jobs for this user at `now` (null dominion = user-wide).
  plan(userId: string, now: Date): Promise<ThinkingJobSpec[]>
  // Validate + ground + persist raw model text from any reasoner.
  apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome>
  // Run the job without the routine (paid key, then deterministic if possible).
  fallback(job: ThinkingJobRow): Promise<ApplyOutcome>
}
