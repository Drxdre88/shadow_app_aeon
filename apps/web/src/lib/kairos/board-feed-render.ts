// ─────────────────────────────────────────────────────────────────────────
// Kairos board feed — pure page assembly (no DB). The operator runs his day
// on a board; these pages turn a day (or a week) of card activity into one
// durable memory per board, reading cards in full: title, notes, checklist,
// labels, days taken. See research/kairos_2909/vision/feeding.md.
// ─────────────────────────────────────────────────────────────────────────

import type { KairosCardNotesMeta } from '@/lib/data/ask'
import type { BoardDayPageRow } from '@/lib/data/board-feed'

export type KairosFeedMode = 'daily' | 'weekly'

/** projects.settings.kairosFeed — absent / unknown value = feed off. */
export function parseKairosFeed(settings: unknown): KairosFeedMode | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).kairosFeed
  if (typeof raw !== 'string') return null
  const mode = raw.trim().toLowerCase()
  return mode === 'daily' || mode === 'weekly' ? mode : null
}

export interface FeedCard {
  taskId?: string
  vaultId?: string
  title: string
  description: string | null
  checklist: { done: number; total: number; items: Array<{ title: string; done: boolean }> }
  labels: string[]
  daysTaken: number | null
  columnName?: string | null
  /** When the card finished / was created — drives recency ordering. */
  at: Date
}

export interface FeedCardRef {
  taskId?: string
  vaultId?: string
  title: string
}

const DESCRIPTION_MAX = 400
const WEEK_DESCRIPTION_MAX = 200
const CHECKLIST_ITEMS_MAX = 8
const THIN_CARDS_MAX = 3
const WEEK_COLUMN_CARDS_MAX = 25
const TITLE_MAX = 255

export function trimText(text: string | null | undefined, max: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

export function hasNotes(card: Pick<FeedCard, 'description'>): boolean {
  return (card.description ?? '').trim().length > 0
}

export function isTitleOnly(card: Pick<FeedCard, 'description' | 'checklist'>): boolean {
  return !hasNotes(card) && card.checklist.total === 0
}

function cardRef(card: FeedCard): FeedCardRef {
  return {
    ...(card.taskId ? { taskId: card.taskId } : {}),
    ...(card.vaultId ? { vaultId: card.vaultId } : {}),
    title: card.title,
  }
}

function cardHeadline(card: FeedCard): string {
  const bits = [`**${card.title}**`]
  if (card.checklist.total > 0) bits.push(`checklist ${card.checklist.done}/${card.checklist.total}`)
  if (card.labels.length > 0) bits.push(`labels: ${card.labels.join(', ')}`)
  if (card.daysTaken !== null) bits.push(`${card.daysTaken}d`)
  return `- ${bits.join(' · ')}`
}

function renderFullCard(card: FeedCard, descriptionMax = DESCRIPTION_MAX): string[] {
  const lines = [cardHeadline(card)]
  if (hasNotes(card)) lines.push(`  Notes: ${trimText(card.description, descriptionMax)}`)
  const items = card.checklist.items.slice(0, CHECKLIST_ITEMS_MAX)
  for (const item of items) lines.push(`  - [${item.done ? 'x' : ' '}] ${trimText(item.title, 160)}`)
  const hidden = card.checklist.items.length - items.length
  if (hidden > 0) lines.push(`  - …${hidden} more item(s)`)
  return lines
}

function byRecency(left: FeedCard, right: FeedCard): number {
  return right.at.getTime() - left.at.getTime()
}

function truncateTitle(title: string): string {
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1)}…`
}

// ─── daily page ───────────────────────────────────────────────────────────

export interface BoardDayInput {
  projectName: string
  date: string
  finished: FeedCard[]
  started: Array<{ taskId: string; title: string; columnName: string | null }>
  created: FeedCard[]
}

export interface BoardDayPage {
  title: string
  bodyMd: string
  finished: Array<FeedCardRef & { hasNotes: boolean }>
  thinCards: FeedCardRef[]
}

/** Null when nothing happened on the board in the window — no page that day. */
export function buildBoardDayPage(input: BoardDayInput): BoardDayPage | null {
  if (input.finished.length === 0 && input.started.length === 0 && input.created.length === 0) return null

  const finished = [...input.finished].sort(byRecency)
  const created = [...input.created].sort(byRecency)
  const lines: string[] = [`**${input.projectName}** — board day ${input.date}`]

  if (finished.length > 0) {
    lines.push('', `**Finished (${finished.length})**`)
    for (const card of finished) lines.push(...renderFullCard(card))
  }
  if (input.started.length > 0) {
    lines.push('', `**Started / moved into active columns (${input.started.length})**`)
    for (const card of input.started) {
      lines.push(`- ${card.title}${card.columnName ? ` → ${card.columnName}` : ''}`)
    }
  }
  if (created.length > 0) {
    lines.push('', `**Created — intent (${created.length})**`)
    for (const card of created) lines.push(...renderFullCard(card))
  }

  const seen = new Set<string>()
  const titleOnly = [...finished, ...created].filter((card) => {
    const key = card.taskId ?? card.vaultId ?? card.title
    if (seen.has(key) || !isTitleOnly(card)) return false
    seen.add(key)
    return true
  })
  if (titleOnly.length > 0) {
    lines.push('', `**Title-only cards (${titleOnly.length}) — meaning unknown until explained**`)
    for (const card of titleOnly) lines.push(`- ${card.title}`)
  }

  return {
    title: truncateTitle(`${input.date} · ${input.projectName} · board day`),
    bodyMd: lines.join('\n'),
    finished: finished.map((card) => ({ ...cardRef(card), hasNotes: hasNotes(card) })),
    thinCards: finished.filter(isTitleOnly).slice(0, THIN_CARDS_MAX).map(cardRef),
  }
}

// ─── weekly milestone page ────────────────────────────────────────────────

export interface BoardWeekInput {
  projectName: string
  isoWeek: string
  columns: Array<{ name: string; cards: FeedCard[] }>
  finished: FeedCard[]
  created: FeedCard[]
  moved: Array<{ title: string; columnName: string | null }>
  untouched: Array<{ title: string; columnName: string | null; days: number }>
}

export function buildBoardWeekPage(input: BoardWeekInput): { title: string; bodyMd: string } | null {
  const liveCount = input.columns.reduce((n, col) => n + col.cards.length, 0)
  if (liveCount === 0 && input.finished.length === 0 && input.created.length === 0) return null

  const lines: string[] = [`**${input.projectName}** — weekly milestone check ${input.isoWeek}`, '', '**Board now**']
  for (const column of input.columns) {
    lines.push('', `_${column.name}_ (${column.cards.length})`)
    const shown = column.cards.slice(0, WEEK_COLUMN_CARDS_MAX)
    for (const card of shown) {
      const progress = card.checklist.total > 0 ? ` · checklist ${card.checklist.done}/${card.checklist.total}` : ''
      const notes = hasNotes(card) ? ` — ${trimText(card.description, WEEK_DESCRIPTION_MAX)}` : ''
      lines.push(`- **${card.title}**${progress}${notes}`)
    }
    if (column.cards.length > shown.length) lines.push(`- …${column.cards.length - shown.length} more`)
  }

  lines.push('', '**Changed in the last 7 days**')
  if (input.finished.length === 0 && input.created.length === 0 && input.moved.length === 0) {
    lines.push('- Nothing moved.')
  }
  for (const card of [...input.finished].sort(byRecency)) lines.push(`- Finished: ${card.title}`)
  for (const card of [...input.created].sort(byRecency)) lines.push(`- Added: ${card.title}`)
  for (const move of input.moved) lines.push(`- Moved: ${move.title}${move.columnName ? ` → ${move.columnName}` : ''}`)

  if (input.untouched.length > 0) {
    lines.push('', `**Untouched for over 30 days (${input.untouched.length})**`)
    for (const card of [...input.untouched].sort((a, b) => b.days - a.days)) {
      lines.push(`- ${card.title}${card.columnName ? ` (${card.columnName})` : ''} · ${card.days}d`)
    }
  }

  return {
    title: truncateTitle(`${input.isoWeek} · ${input.projectName} · board week`),
    bodyMd: lines.join('\n'),
  }
}

/** ISO-8601 week label for a UTC instant, e.g. 2026-W40. */
export function isoWeekLabel(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNumber = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// ─── thin-card nudge (ask-mine card_notes) ────────────────────────────────

export function buildCardNotesQuestion(titles: string[]): string {
  const count = titles.length
  const headline = `**${count} card${count === 1 ? '' : 's'} closed with no notes**`
  const numbered = titles.map((title, index) => `${index + 1}. ${title.replace(/\?/g, '')}`)
  const ask = count === 1
    ? 'One line on what it was and why it mattered?'
    : 'One line each, numbered, on what they were and why they mattered?'
  return [
    headline,
    '',
    'Finished yesterday with a title only, so I can\'t tell what they meant.',
    '',
    ...numbered,
    '',
    ask,
  ].join('\n')
}

export type ThinCard = KairosCardNotesMeta['cards'][number]

/** Valid thin-card refs from a board_day page (defensive: metadata is jsonb). */
export function thinCardsFromPage(page: BoardDayPageRow): ThinCard[] {
  const metadata = (page.sourceMetadata ?? {}) as Record<string, unknown>
  const raw = Array.isArray(metadata.thinCards) ? metadata.thinCards : []
  const projectId = page.projectId ?? (typeof metadata.projectId === 'string' ? metadata.projectId : null)
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const card = entry as Record<string, unknown>
    if (typeof card.title !== 'string' || !card.title.trim()) return []
    const taskId = typeof card.taskId === 'string' ? card.taskId : undefined
    const vaultId = typeof card.vaultId === 'string' ? card.vaultId : undefined
    if (!taskId && !vaultId) return []
    return [{ ...(taskId ? { taskId } : {}), ...(vaultId ? { vaultId } : {}), projectId, title: card.title.trim() }]
  })
}
