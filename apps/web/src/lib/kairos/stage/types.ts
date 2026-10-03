import type {
  KairosStageState,
  StageCoalition,
  StageCycle,
  StageFocus,
  StageMember,
  StageSource,
  StageTier,
} from '@/lib/data/validators/kairos-stage'

export type { KairosStageState, StageCoalition, StageCycle, StageFocus, StageMember, StageSource, StageTier }

// One thought a producer offers the stage (a handler's ok outcome `thoughts`,
// or an optional `stage` array in model output via parseStageItems). All
// salience components are 0–1; `cites` are memory ids (stored, never rendered).
export type StageCandidateInput = {
  text: string
  importance: number
  surprise: number
  goalRelevance: number
  need: number
  cites?: string[]
}

export type StageMode = 'off' | 'observe' | 'on'

// One post to the selector: the thoughts of a single job (or one ambient fact).
export interface StagePost {
  kind: string
  source: StageSource
  tier: StageTier
  jobId?: string
  // Coalition ids the job was shown at claim (echo rule).
  given?: string[]
  items: StageCandidateInput[]
}

// A server fact recomputed on cycle rollover; `key` is stable per London day.
// 'job' is allowed for surprise-ledger findings (contradiction, support lost, aha).
export interface AmbientCandidate extends StageCandidateInput {
  key: string
  kind: string
  source: StageSource
  tier: StageTier
}

export interface StageBlock {
  block: string
  given: string[]
  cycle: string
}

export interface StagePostResult {
  posted: number
  merged: number
  echoed: number
  ambient: number
  dropped: number
  skipped?: 'off' | 'duplicate_job' | 'empty' | 'error'
}
