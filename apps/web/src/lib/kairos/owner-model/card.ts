import type { InlineKeyboardButton } from '@/lib/kairos/telegram'
import type { KairosOwnerModel, OwnerItem } from '@/lib/data/validators/kairos-owner-model'
import { isoWeekKey, londonDateHour } from '@/lib/kairos/thinking/deadlines'
import { findBySeq, heldTraits, isActionable, isLongRunning, liveStates, traitCandidates } from './status'
import { neutralise, shortDate } from './text'

// The weekly "what I think you're carrying" card (spec_B §3.5). Deterministic:
// no model call, no paid path. Due Sunday 18:00 → Monday 12:00 London, once
// per ISO week (the Monday's week).

export const CARRYING_CARD_TITLE = "What I think you're carrying"
export const CARRYING_CARD_FOOTER = 'Reply "C1 still", "C1 over", "C3 wrong", or "C2: <what\'s really going on>".'
export const OWNER_CALLBACK_RE = /^om1:([kx]):(\d{1,4})$/

export function cardWindow(now: Date): { isoWeek: string } | null {
  const { date, hour } = londonDateHour(now)
  const noon = new Date(`${date}T12:00:00.000Z`)
  const weekday = noon.getUTCDay()
  if (weekday === 0 && hour >= 18) return { isoWeek: isoWeekKey(new Date(noon.getTime() + 86_400_000)) }
  if (weekday === 1 && hour < 12) return { isoWeek: isoWeekKey(noon) }
  return null
}

export const carryingExternalId = (isoWeek: string): string => `kairos-carrying:${isoWeek}`

export interface CarryingCard {
  message: string
  seqs: number[]
  keyboard: InlineKeyboardButton[][]
}

export function cardItems(model: KairosOwnerModel, now: Date): OwnerItem[] {
  return [...liveStates(model, now), ...heldTraits(model, now), ...traitCandidates(model).slice(0, 1)]
}

function line(item: OwnerItem, now: Date): string {
  const text = neutralise(item.text)
  if (item.kind === 'trait') return item.status === 'candidate' ? `C${item.seq} · ${text} — right?` : `C${item.seq} · ${text} (lasting)`
  const dates = `since ${shortDate(item.firstSeenAt)}, lapses ${shortDate(item.expiresAt ?? item.lastConfirmedAt)}`
  return isLongRunning(item, now)
    ? `C${item.seq} · ${text} (${dates}) — still a phase, or part of you?`
    : `C${item.seq} · ${text} (${dates})`
}

export function carryingRow(item: OwnerItem): InlineKeyboardButton[] {
  const C = `C${item.seq}`
  const keep = item.kind === 'state' ? `${C} still` : `${C} yes`
  const drop = item.kind === 'state' ? `${C} over` : `${C} wrong`
  return [
    { text: keep, callback_data: `om1:k:${item.seq}` },
    { text: drop, callback_data: `om1:x:${item.seq}` },
  ]
}

export function carryingKeyboard(items: readonly OwnerItem[]): InlineKeyboardButton[][] {
  return items.map(carryingRow)
}

// null when nothing is live and no candidate waits (the week is skipped).
export function renderCarryingCard(model: KairosOwnerModel, now: Date): CarryingCard | null {
  const items = cardItems(model, now)
  if (items.length === 0) return null
  const message = [
    'Here is my working read of what you are carrying. Correct anything that is off.',
    '',
    ...items.map((i) => line(i, now)),
    '',
    CARRYING_CARD_FOOTER,
  ].join('\n')
  return { message, seqs: items.map((i) => i.seq), keyboard: carryingKeyboard(items) }
}

// Rows still open on the latest card holding `seq` (acted seqs drop out),
// plus the speak Dismiss row the edit would otherwise remove.
export function remainingKeyboard(model: KairosOwnerModel, seq: number, now: Date): InlineKeyboardButton[][] {
  const card = [...model.cards].reverse().find((c) => c.seqs.includes(seq))
  if (!card) return []
  const acted = new Set(card.acted ?? [])
  const rows = card.seqs
    .filter((s) => !acted.has(s))
    .flatMap((s) => {
      const item = findBySeq(model, s)
      return item && isActionable(item, now) ? [carryingRow(item)] : []
    })
  return card.memoryId ? [...rows, [{ text: 'Dismiss', callback_data: `dismiss:${card.memoryId}` }]] : rows
}
