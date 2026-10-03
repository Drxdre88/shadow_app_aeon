import type { KairosIdeaShelf, ShelfItem } from '@/lib/data/validators/kairos-idea-shelf'
import { SHELF_MAX_ITEMS, SHELF_MAX_OFFERS } from '@/lib/data/validators/kairos-idea-shelf'
import { londonDateHour } from '@/lib/kairos/thinking/deadlines'

// Incubation shelf policy (pure). A near-miss is an idea that passed every
// quality gate and only lost on rank (ranked_out, rank ≤ that night's
// survivors + 2). Between 2 and 14 days after its night the hourly pulse may
// be shown one, oldest first; it resurfaces at most once per London day, is
// shown at most once per London day, and fades after 3 offers.

export const NEAR_MISS_EXTRA_RANKS = 2
export const SHELF_MIN_AGE_DAYS = 2
export const SHELF_MAX_AGE_DAYS = 14
export const SHELF_RETENTION_DAYS = 30
const DAY_MS = 86_400_000

export interface NearMissRow {
  id: string
  title: string
  claim: string
  nextStep: string
  direction: string
  tournamentDate: string
  rank: number | null
  status: string
  eliminatedReason: string | null
}

export const emptyShelf = (): KairosIdeaShelf => ({ v: 1, items: [], lastResurfaceDay: null })

const utcDayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const londonDayOf = (d: Date) => londonDateHour(d).date

// UTC tournament nights eligible for an offer at `now` (inclusive).
export function shelfWindow(now: Date): { fromDay: string; toDay: string } {
  return {
    fromDay: utcDayOf(now.getTime() - SHELF_MAX_AGE_DAYS * DAY_MS),
    toDay: utcDayOf(now.getTime() - SHELF_MIN_AGE_DAYS * DAY_MS),
  }
}

export function pickNearMisses(rows: readonly NearMissRow[]): NearMissRow[] {
  const survivors = new Map<string, number>()
  for (const r of rows) if (r.status === 'survivor') survivors.set(r.tournamentDate, (survivors.get(r.tournamentDate) ?? 0) + 1)
  return rows.filter((r) => r.eliminatedReason === 'ranked_out' && r.rank !== null
    && r.rank <= (survivors.get(r.tournamentDate) ?? 0) + NEAR_MISS_EXTRA_RANKS)
}

const offeredOn = (item: ShelfItem, day: string) => item.lastOfferedAt !== null && londonDayOf(new Date(item.lastOfferedAt)) === day

export function pickOffer(nearMisses: readonly NearMissRow[], state: KairosIdeaShelf, now: Date): NearMissRow | null {
  const today = londonDayOf(now)
  if (state.lastResurfaceDay === today) return null
  const { fromDay, toDay } = shelfWindow(now)
  const byId = new Map(state.items.map((i) => [i.id, i]))
  const open = nearMisses.filter((r) => {
    if (r.tournamentDate < fromDay || r.tournamentDate > toDay) return false
    const item = byId.get(r.id)
    return !item || (!item.resurfacedAt && !item.fadedAt && item.offers < SHELF_MAX_OFFERS && !offeredOn(item, today))
  })
  open.sort((a, b) => a.tournamentDate.localeCompare(b.tournamentDate) || (a.rank ?? 0) - (b.rank ?? 0) || a.id.localeCompare(b.id))
  return open[0] ?? null
}

export function applyOffer(state: KairosIdeaShelf, id: string, slot: string, now: Date): KairosIdeaShelf {
  const at = now.toISOString()
  const prev = state.items.find((i) => i.id === id)
  const offers = Math.min(SHELF_MAX_OFFERS, (prev?.offers ?? 0) + 1)
  const next: ShelfItem = {
    id,
    offers,
    lastOfferedAt: at,
    slot,
    resurfacedAt: prev?.resurfacedAt ?? null,
    fadedAt: prev?.fadedAt ?? (offers >= SHELF_MAX_OFFERS ? at : null),
  }
  return { ...state, items: [...state.items.filter((i) => i.id !== id), next] }
}

// null = refused (already resurfaced today, or this item already came back).
export function applyResurface(state: KairosIdeaShelf, id: string, now: Date): KairosIdeaShelf | null {
  const today = londonDayOf(now)
  const prev = state.items.find((i) => i.id === id)
  if (state.lastResurfaceDay === today || prev?.resurfacedAt) return null
  const base: ShelfItem = prev ?? { id, offers: 1, lastOfferedAt: null, slot: null, resurfacedAt: null, fadedAt: null }
  const item: ShelfItem = { ...base, resurfacedAt: now.toISOString() }
  return { ...state, lastResurfaceDay: today, items: [...state.items.filter((i) => i.id !== id), item] }
}

const lastTouch = (i: ShelfItem) => Math.max(Date.parse(i.lastOfferedAt ?? '') || 0, Date.parse(i.resurfacedAt ?? '') || 0)

// Drop items untouched for 30 days, then keep the newest SHELF_MAX_ITEMS.
export function pruneShelf(state: KairosIdeaShelf, now: Date): KairosIdeaShelf {
  const cutoff = now.getTime() - SHELF_RETENTION_DAYS * DAY_MS
  const live = state.items.filter((i) => lastTouch(i) >= cutoff)
  const kept = live.length > SHELF_MAX_ITEMS
    ? [...live].sort((a, b) => lastTouch(b) - lastTouch(a)).slice(0, SHELF_MAX_ITEMS).sort((a, b) => lastTouch(a) - lastTouch(b))
    : live
  return { ...state, items: kept }
}
