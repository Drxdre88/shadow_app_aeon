// Natural-break detection for the Kairos gate. Pure: signals in, verdict out.
// First matching rule wins (spec_A_gate §4):
//   1. owner chatted within CHAT_QUIET           → hold chat_live
//   2. no activity, or idle for ≥ AWAY           → send idle
//   3. newest act is a card close / session end
//      within EVENT_BREAK_MIN                    → send card_closed / session_ended
//   4. quiet for ≥ QUIET                         → send chat_ended (Kairos answered
//                                                  his last chat turn) or quiet
//   5. otherwise                                 → hold busy
// MCP `used` lines never count as activity (agents working is not the owner busy).

import type { GateLimits } from './flag'

export const EVENT_BREAK_MIN = 30
const MIN_MS = 60_000

export type BreakReason = 'chat_live' | 'busy' | 'idle' | 'card_closed' | 'session_ended' | 'chat_ended' | 'quiet'
export type BreakTrigger = 'card_closed' | 'session_ended'

export interface GateSignals {
  lastOwnerAt: Date | null
  lastOwnerChatAt: Date | null
  lastKairosReplyAt: Date | null
  cardClosedAt: Date | null
  sessionEndedAt: Date | null
}

export interface BreakVerdict {
  action: 'send' | 'hold'
  reason: BreakReason
}

export interface GateTodayEntry {
  at: string
  channel: string
  type: string
  speaker: string
  relayed: boolean
}

const CHAT_CHANNELS = new Set(['web', 'telegram', 'triad'])

const later = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : a.getTime() >= b.getTime() ? a : b)

export const isOwnerEntry = (e: GateTodayEntry): boolean => e.speaker === 'owner' || e.relayed

// Folds today-log entries (any order) into the break signals.
export function signalsFromEntries(entries: readonly GateTodayEntry[], cardClosedAt: Date | null = null): GateSignals {
  const out: GateSignals = { lastOwnerAt: null, lastOwnerChatAt: null, lastKairosReplyAt: null, cardClosedAt, sessionEndedAt: null }
  for (const e of entries) {
    if (e.type === 'used') continue
    const at = new Date(e.at)
    if (Number.isNaN(at.getTime())) continue
    if (e.channel === 'session' && e.type === 'captured') out.sessionEndedAt = later(out.sessionEndedAt, at)
    else if (e.type === 'replied' && e.speaker === 'kairos') out.lastKairosReplyAt = later(out.lastKairosReplyAt, at)
    else if (isOwnerEntry(e)) {
      out.lastOwnerAt = later(out.lastOwnerAt, at)
      if (e.type === 'said' && CHAT_CHANNELS.has(e.channel)) out.lastOwnerChatAt = later(out.lastOwnerChatAt, at)
    }
  }
  return out
}

// An event hook (card closed / session ended) is itself the freshest signal.
export function withTrigger(signals: GateSignals, trigger: BreakTrigger | null, now: Date): GateSignals {
  if (trigger === 'card_closed') return { ...signals, cardClosedAt: later(signals.cardClosedAt, now) }
  if (trigger === 'session_ended') return { ...signals, sessionEndedAt: later(signals.sessionEndedAt, now) }
  return signals
}

const ago = (now: Date, at: Date) => now.getTime() - at.getTime()

export function detectBreak(s: GateSignals, now: Date, limits: Pick<GateLimits, 'quietMin' | 'chatQuietMin' | 'awayMin'>): BreakVerdict {
  if (s.lastOwnerChatAt && ago(now, s.lastOwnerChatAt) < limits.chatQuietMin * MIN_MS) return { action: 'hold', reason: 'chat_live' }

  const lastActive = later(later(s.lastOwnerAt, s.cardClosedAt), s.sessionEndedAt)
  if (!lastActive || ago(now, lastActive) >= limits.awayMin * MIN_MS) return { action: 'send', reason: 'idle' }

  const fresh = ago(now, lastActive) < EVENT_BREAK_MIN * MIN_MS
  if (fresh && s.cardClosedAt && s.cardClosedAt.getTime() === lastActive.getTime()) return { action: 'send', reason: 'card_closed' }
  if (fresh && s.sessionEndedAt && s.sessionEndedAt.getTime() === lastActive.getTime()) return { action: 'send', reason: 'session_ended' }

  if (ago(now, lastActive) >= limits.quietMin * MIN_MS) {
    const lastWasChat = Boolean(s.lastOwnerChatAt && s.lastOwnerAt && s.lastOwnerChatAt.getTime() === lastActive.getTime())
    const answered = Boolean(lastWasChat && s.lastKairosReplyAt && s.lastKairosReplyAt.getTime() > s.lastOwnerChatAt!.getTime())
    return { action: 'send', reason: answered ? 'chat_ended' : 'quiet' }
  }
  return { action: 'hold', reason: 'busy' }
}
