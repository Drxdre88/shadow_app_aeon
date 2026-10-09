import { DAILY_BRIEF_MAX_CHARS, QUIET_DAY_LINE, briefHeadline, briefLookAhead, overflowPointer, type DailyBrief } from '../daily-brief'
import type { DailyMessageInputs } from '../daily-message-prompt'
import { VERDICT_DECK_FOOTER, VERDICT_DECK_MAX_ITEMS, type DeckCandidate, type DeckItem } from './types'

// The Sunday verdict deck text (pure). Every item waiting on the owner,
// numbered 1..N oldest first, at most 10 shown, one short line each, then
// "+N more in your inbox." and the reply footer. Nothing waiting → the
// ordinary quiet-day line.

export const VERDICT_DECK_MAX_CHARS = 1500
const HEADLINE_FALLBACK = 'Sunday review.'
const TITLE_CHARS = [70, 50, 35, 20] as const

export interface VerdictDeckBrief {
  brief: DailyBrief
  items: DeckItem[]
}

function clip(text: string, max: number): string {
  const flat = text.replace(/https?:\/\/\S+/gi, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

// Oldest first (ties: kind order as listed, then label), capped.
export function numberDeck(candidates: ReadonlyArray<DeckCandidate>): { items: DeckItem[]; overflow: number } {
  const sorted = [...candidates].sort((a, b) =>
    (Date.parse(a.since) || 0) - (Date.parse(b.since) || 0) || (a.label ?? '').localeCompare(b.label ?? '') || a.id.localeCompare(b.id))
  const shown = sorted.slice(0, VERDICT_DECK_MAX_ITEMS)
  const items = shown.map((c, i) => ({ n: i + 1, kind: c.kind, id: c.id, label: c.label, title: clip(c.title, 300) }))
  return { items, overflow: sorted.length - shown.length }
}

export function deckLine(item: DeckItem, chars: number): string {
  const title = clip(item.title, chars)
  switch (item.kind) {
    case 'idea': return `${item.n}. 💡 ${title}`
    case 'prediction': return `${item.n}. ${item.label} · ${title} — right?`
    default: return `${item.n}. ${item.label ? `${item.label} · ` : ''}${title}`
  }
}

export function buildVerdictDeck(
  narrative: string,
  candidates: ReadonlyArray<DeckCandidate>,
  inputs: DailyMessageInputs,
  now: Date,
): VerdictDeckBrief {
  const { items, overflow } = numberDeck(candidates)
  if (items.length === 0) {
    const look = briefLookAhead(narrative, inputs, now)
    const line = look ? `${QUIET_DAY_LINE} ${look}` : QUIET_DAY_LINE
    return { brief: { text: line.length <= DAILY_BRIEF_MAX_CHARS ? line : QUIET_DAY_LINE, ideas: [], overflow: 0, quiet: true }, items: [] }
  }
  const headline = `**${briefHeadline(narrative) ?? HEADLINE_FALLBACK}**`
  const foot = [...(overflow > 0 ? [overflowPointer(overflow)] : []), VERDICT_DECK_FOOTER].join('\n')
  const render = (chars: number) => [headline, items.map((i) => deckLine(i, chars)).join('\n'), foot].join('\n\n')
  let text = render(TITLE_CHARS[TITLE_CHARS.length - 1])
  for (const chars of TITLE_CHARS) {
    const candidate = render(chars)
    if (candidate.length <= VERDICT_DECK_MAX_CHARS) {
      text = candidate
      break
    }
  }
  return { brief: { text, ideas: [], overflow, quiet: false }, items }
}
