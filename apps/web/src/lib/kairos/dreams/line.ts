import { listJobs } from '@/lib/data/thinking-jobs'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

// The "I dreamt…" line (wave 2b). Code-built from the morning read's
// morningLine (or the dream title), appended to the 06:00 Telegram send ONLY:
// never stored, never in the inbox capture or the today log (speak.ts
// telegram tail). At most three a week — London Tue/Thu/Sat, never Monday —
// and only once today's dream_read is done. Reads job output read-only.

export const DREAM_LINE_WEEKDAYS: readonly string[] = ['Tue', 'Thu', 'Sat']
export const DREAM_LINE_MAX_CHARS = 160
const PREFIX = '💭 '
const ELLIPSIS = '…'
const DAY_MS = 24 * 60 * 60 * 1000

const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
})

function londonDay(now: Date): { date: string; weekday: string } {
  const p: Record<string, string> = {}
  for (const part of londonFormat.formatToParts(now)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday }
}

export function isDreamLineDay(now: Date): boolean {
  return DREAM_LINE_WEEKDAYS.includes(londonDay(now).weekday)
}

// Plain one-liner: no URLs, headings, markdown, uuids, prompt aliases
// (m1, b2, p3, g4) or ask/promise refs (Q1, P2).
export function sanitiseDreamText(text: string): string {
  return text
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/\b[QP]\d+\b/g, ' ')
    .replace(/\b[mbpg]\d+\b/g, ' ')
    .replace(/[`*_>#|~]/g, ' ')
    .replace(/\[\s*\]|\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text
  const hard = text.slice(0, max - ELLIPSIS.length)
  const space = hard.lastIndexOf(' ')
  const cut = space >= Math.floor(hard.length * 0.6) ? hard.slice(0, space) : hard
  return `${cut.replace(/[\s,;:.-]+$/, '')}${ELLIPSIS}`
}

// morningLine when it reads as "I dreamt…", else `I dreamt about <title>.`;
// null when neither yields text.
export function buildDreamLine(morningLine: unknown, title: unknown): string | null {
  const room = DREAM_LINE_MAX_CHARS - PREFIX.length
  const line = typeof morningLine === 'string' ? sanitiseDreamText(morningLine) : ''
  if (/^i dreamt\b/i.test(line)) return `${PREFIX}${cap(`I${line.slice(1)}`, room)}`
  const t = typeof title === 'string' ? sanitiseDreamText(title).replace(/[.!?]+$/, '') : ''
  if (!t) return null
  return `${PREFIX}${cap(`I dreamt about ${t}.`, room)}`
}

const outputDate = (j: ThinkingJobRow) => j.output?.date

export async function readDreamLine(userId: string, now: Date): Promise<string | null> {
  if (!isDreamLineDay(now)) return null
  const { date } = londonDay(now)
  try {
    const since = new Date(now.getTime() - 2 * DAY_MS)
    const reads = await listJobs(userId, { kind: 'dream_read', status: 'done', since, limit: 10 })
    const read = reads.find((j) => j.kind === 'dream_read' && j.status === 'done' && outputDate(j) === date)
    if (!read) return null
    const dreamJobId = read.output?.dreamJobId
    const dreams = await listJobs(userId, { kind: 'dream', status: 'done', since, limit: 10 })
    const dream = dreams.find((j) => j.kind === 'dream' && j.status === 'done' && (j.id === dreamJobId || outputDate(j) === date))
    return buildDreamLine(read.output?.morningLine, dream?.output?.title)
  } catch (err) {
    console.warn('[kairos:dream-line] lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}
