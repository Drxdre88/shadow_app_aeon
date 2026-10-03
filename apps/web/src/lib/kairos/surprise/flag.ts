import { stageMode } from '@/lib/kairos/stage/flag'

// Surprise-as-engine flags (spec_surprise). All default off in code → every
// prompt byte-identical. Tri-state flags: unset/'0' → 'off'; 'observe' →
// compute + log, change nothing; '1'/'on' → live.

export type SurpriseMode = 'off' | 'observe' | 'on'

function triState(name: string): SurpriseMode {
  const raw = (process.env[name] ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

function binary(name: string): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'on'
}

// KAIROS_SURPRISE_GATE 0|observe|1 — gate Kairos rewrites of beliefs on open marks.
export const surpriseGateMode = (): SurpriseMode => triState('KAIROS_SURPRISE_GATE')

// KAIROS_SURPRISE_CONTRADICTIONS 0|1 — conscience contradictions open beliefs
// (reverses the "measurement only" conscience invariant; owner sign-off).
export const surpriseContradictionsOn = (): boolean => binary('KAIROS_SURPRISE_CONTRADICTIONS')

// KAIROS_SURPRISE_CREDIT 0|observe|1 — backward credit through belief citers.
export const surpriseCreditMode = (): SurpriseMode => triState('KAIROS_SURPRISE_CREDIT')

// KAIROS_CURIOSITY_LP 0|observe|1 — learning-progress bias for ask_mine.
export const curiosityLpMode = (): SurpriseMode => triState('KAIROS_CURIOSITY_LP')

// KAIROS_SURPRISE_REPLAY 0|observe|1 — replay due-soon / questioned memories.
export const surpriseReplayMode = (): SurpriseMode => triState('KAIROS_SURPRISE_REPLAY')

// KAIROS_SURPRISE_STAGE 0|1 — ledger events feed the stage. No-op unless the
// stage itself is on or observing (KAIROS_STAGE != off).
export const surpriseStageOn = (): boolean => binary('KAIROS_SURPRISE_STAGE') && stageMode() !== 'off'
