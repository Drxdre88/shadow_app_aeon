import type {
  KairosOwnerModel,
  OwnerItem,
  OwnerItemKind,
  OwnerItemStatus,
} from '@/lib/data/validators/kairos-owner-model'
import { normaliseText, tokenOverlap } from './text'

// Pure read-side owner-model rules (spec_B §3.2): a state's effective status
// is computed from `now` on every read; the mutator saves it on its next write.

export const DAY_MS = 86_400_000
export const REVIVE_DAYS = 7
export const STATE_VETO_DAYS = 30
export const TRAIT_VETO_DAYS = 180
export const VETO_OVERLAP = 0.6
export const MAX_LIVE_STATES = 8
export const MAX_HELD_TRAITS = 8
export const LONG_RUNNING_DAYS = 42

export function emptyOwnerModel(): KairosOwnerModel {
  return { v: 1, nextSeq: 1, items: [], vetoes: [], cards: [], corrections: [] }
}

export const isoMs = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN)

export function stateExpiry(lastConfirmedAt: string, ttlDays: number): string {
  return new Date(isoMs(lastConfirmedAt) + ttlDays * DAY_MS).toISOString()
}

// A held state lapses at exactly expiresAt.
export function effectiveStatus(item: OwnerItem, now: Date): OwnerItemStatus {
  if (item.kind === 'state' && item.status === 'held') {
    const until = isoMs(item.expiresAt)
    if (Number.isFinite(until) && now.getTime() >= until) return 'expired'
  }
  return item.status
}

export function isLive(item: OwnerItem, now: Date): boolean {
  return effectiveStatus(item, now) === 'held'
}

// Expired within REVIVE_DAYS: "C1 still" can bring it back.
export function isRevivable(item: OwnerItem, now: Date): boolean {
  if (item.kind !== 'state' || effectiveStatus(item, now) !== 'expired') return false
  return now.getTime() - isoMs(item.expiresAt) <= REVIVE_DAYS * DAY_MS
}

export function isActionable(item: OwnerItem, now: Date): boolean {
  const status = effectiveStatus(item, now)
  return status === 'held' || status === 'candidate' || isRevivable(item, now)
}

export function isLongRunning(item: OwnerItem, now: Date): boolean {
  if (item.kind !== 'state' || !isLive(item, now)) return false
  return isoMs(item.lastConfirmedAt) - isoMs(item.firstSeenAt) > LONG_RUNNING_DAYS * DAY_MS
}

export const newestFirst = (a: OwnerItem, b: OwnerItem): number =>
  isoMs(b.lastConfirmedAt) - isoMs(a.lastConfirmedAt) || b.seq - a.seq

export function liveStates(model: KairosOwnerModel, now: Date): OwnerItem[] {
  return model.items.filter((i) => i.kind === 'state' && isLive(i, now)).sort(newestFirst).slice(0, MAX_LIVE_STATES)
}

export function heldTraits(model: KairosOwnerModel, now: Date): OwnerItem[] {
  return model.items.filter((i) => i.kind === 'trait' && isLive(i, now)).sort(newestFirst).slice(0, MAX_HELD_TRAITS)
}

export function traitCandidates(model: KairosOwnerModel): OwnerItem[] {
  return model.items.filter((i) => i.kind === 'trait' && i.status === 'candidate').sort(newestFirst)
}

export function findBySeq(model: KairosOwnerModel, seq: number): OwnerItem | undefined {
  return model.items.find((i) => i.seq === seq)
}

export function isVetoed(model: KairosOwnerModel, kind: OwnerItemKind, text: string, now: Date): boolean {
  return model.vetoes.some((v) => v.kind === kind && isoMs(v.until) > now.getTime() && tokenOverlap(v.norm, text) >= VETO_OVERLAP)
}

export function vetoFor(item: OwnerItem, now: Date): { norm: string; kind: OwnerItemKind; until: string } {
  const days = item.kind === 'state' ? STATE_VETO_DAYS : TRAIT_VETO_DAYS
  return { norm: normaliseText(item.text), kind: item.kind, until: new Date(now.getTime() + days * DAY_MS).toISOString() }
}
