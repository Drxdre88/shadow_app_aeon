import type { ThinkingJobKind } from '@/lib/kairos/engine/types'
import type { StageMode } from './types'

// KAIROS_STAGE: unset/'0' → off (prompts byte-identical, nothing posted);
// 'observe' → post + select + API, no injection, no surprise trigger;
// '1' → full. Default off in code.
export function stageMode(): StageMode {
  const raw = (process.env.KAIROS_STAGE ?? '').trim().toLowerCase()
  if (raw === '1' || raw === 'on') return 'on'
  if (raw === 'observe') return 'observe'
  return 'off'
}

export const DEFAULT_STAGE_SURPRISE_THRESHOLD = 1.2

export function stageSurpriseThreshold(): number {
  const raw = process.env.KAIROS_STAGE_SURPRISE_THRESHOLD
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STAGE_SURPRISE_THRESHOLD
}

// Kinds whose model sees the stage. Blind on purpose (spec §4): owner-words →
// memory/beliefs/values kinds (no laundering), the measuring instruments, and
// the idea judge (independence).
export const STAGE_READER_KINDS: readonly ThinkingJobKind[] = [
  'cortex', 'aether', 'idea_generate', 'goal_propose', 'ask_mine', 'weekly_review',
  'agenda_due', 'reflect', 'pulse', 'chat', 'daily_message',
]

// Readers that place the block themselves (chat system context, 06:00 message
// section); the queue never injects for them.
export const STAGE_SELF_INJECTED_KINDS: readonly ThinkingJobKind[] = ['chat', 'daily_message']

// Readers shown only deep/owner-backed coalitions.
export const STAGE_DEEP_ONLY_KINDS: readonly ThinkingJobKind[] = ['goal_propose']

// Speculative posters (dreams): their thoughts always count as light tier, so
// a dream can never back a coalition into ignition or a deep-only reader.
// Dream kinds are never STAGE_READER_KINDS either.
export const STAGE_SPECULATIVE_KINDS: readonly ThinkingJobKind[] = ['dream', 'dream_read']

// Kinds the queue injects for at claim / sweep fallback.
export function queueInjectsStage(kind: ThinkingJobKind): boolean {
  return STAGE_READER_KINDS.includes(kind) && !STAGE_SELF_INJECTED_KINDS.includes(kind)
}
