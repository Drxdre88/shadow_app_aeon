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

export interface MemoryOpInput {
  memoryId: string | null
  step: string
  op: MemoryOpKind
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason: string
}

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
}

export interface StepResult {
  step: string
  examined: number
  changed: number
  skipped?: string
  notes?: string[]
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
  failedSteps: Array<{ step: string; error: string }>
}

// ── Thinking queue ────────────────────────────────────────────────────────

export type ThinkingJobKind = 'aether' | 'cortex' | 'concept'

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
  | { ok: true; memoryIds: string[] }
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
