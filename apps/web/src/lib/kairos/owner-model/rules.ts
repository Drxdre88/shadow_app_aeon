import {
  CANDIDATE_TTL_DAYS,
  PROMOTE_MIN_ANCHORED,
  PROMOTE_MIN_DAYS,
  PROMOTE_MIN_SUPPORTS,
} from '@/lib/kairos/engine/steps/back-up'
import {
  OWNER_MODEL_MAX_CARDS,
  OWNER_MODEL_MAX_CORRECTIONS,
  OWNER_MODEL_MAX_ITEMS,
  OWNER_MODEL_MAX_VETOES,
  type KairosOwnerModel,
  type OwnerItem,
} from '@/lib/data/validators/kairos-owner-model'
import { DAY_MS, effectiveStatus, isoMs, newestFirst } from './status'
import { utcDayOf } from './text'

// Write-side owner-model rules (spec_B §3.2): trait promotion uses BackUp's
// slow-core thresholds (imported, never copied); pruning and caps run on
// every write. Imports BackUp, so lane code loads this module lazily.

export const PRUNE_DAYS = 30
export const MAX_NEW_STATES = 4
export const MAX_NEW_TRAITS = 3
export { CANDIDATE_TTL_DAYS }

// ≥ PROMOTE_MIN_SUPPORTS confirmations on ≥ PROMOTE_MIN_DAYS UTC days, ≥ PROMOTE_MIN_ANCHORED anchored.
export function shouldPromoteTrait(item: OwnerItem): boolean {
  if (item.kind !== 'trait' || item.status !== 'candidate') return false
  const days = new Set(item.confirmations.map((c) => utcDayOf(c.at)))
  const anchored = item.confirmations.filter((c) => c.anchored).length
  return item.confirmations.length >= PROMOTE_MIN_SUPPORTS && days.size >= PROMOTE_MIN_DAYS && anchored >= PROMOTE_MIN_ANCHORED
}

const isOpen = (i: OwnerItem) => i.status === 'held' || i.status === 'candidate'

function closedAt(item: OwnerItem): number {
  return item.status === 'expired' ? isoMs(item.expiresAt) : isoMs(item.closedAt ?? item.lastConfirmedAt)
}

// Lapsed states are saved 'expired', stale candidates retired, closed items
// and lapsed vetoes pruned after PRUNE_DAYS; every list stays capped.
export function pruneOwnerModel(model: KairosOwnerModel, now: Date): KairosOwnerModel {
  const nowMs = now.getTime()
  const items = model.items
    .map((item): OwnerItem => {
      if (item.status === 'held' && effectiveStatus(item, now) === 'expired') {
        return { ...item, status: 'expired', retiredReason: 'expired', closedAt: item.expiresAt }
      }
      if (item.status === 'candidate' && nowMs - isoMs(item.lastConfirmedAt) > CANDIDATE_TTL_DAYS * DAY_MS) {
        return { ...item, status: 'retired', retiredReason: 'expired', closedAt: now.toISOString() }
      }
      return item
    })
    .filter((item) => isOpen(item) || nowMs - closedAt(item) <= PRUNE_DAYS * DAY_MS)
  const ranked = [...items.filter(isOpen).sort(newestFirst), ...items.filter((i) => !isOpen(i)).sort(newestFirst)]
  return {
    ...model,
    items: ranked.slice(0, OWNER_MODEL_MAX_ITEMS).sort((a, b) => a.seq - b.seq),
    vetoes: model.vetoes.filter((v) => isoMs(v.until) > nowMs).slice(-OWNER_MODEL_MAX_VETOES),
    cards: model.cards.slice(-OWNER_MODEL_MAX_CARDS),
    corrections: model.corrections.slice(-OWNER_MODEL_MAX_CORRECTIONS),
  }
}
