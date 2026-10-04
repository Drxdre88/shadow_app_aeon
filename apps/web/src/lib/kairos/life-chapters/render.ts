import { neutraliseFences } from '@/lib/kairos/_prompt-utils'
import type { LifeChapterMeta, LifeChapterView } from '@/lib/data/validators/kairos-life-chapters'

// Pure renderers for life chapters. lintHits is measurement only and is never
// rendered here, so it cannot reach a prompt, the owner's notice or the view.

type ChapterBody = Pick<LifeChapterMeta, 'title' | 'summary' | 'turningPoints' | 'whatChanged' | 'unresolved'>

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return MONTHS[(m ?? 0) - 1] ? `${MONTHS[m - 1]} ${y}` : month
}

const cites = (ids: readonly string[]) => (ids.length ? ` _(${ids.join(', ')})_` : '')

function bodyLines(c: ChapterBody): string[] {
  const lines = [c.summary.trim()]
  if (c.turningPoints.length) {
    lines.push('', '**Turning points**')
    for (const t of c.turningPoints) {
      lines.push(`- ${t.what}${cites(t.evidenceIds)}`)
      if (t.before || t.after) lines.push(`  - before: ${t.before || '—'} · after: ${t.after || '—'}`)
    }
  }
  if (c.whatChanged.length) {
    lines.push('', '**What changed**')
    for (const w of c.whatChanged) lines.push(`- ${w.text}${cites(w.evidenceIds)}`)
  }
  lines.push('', '**Still open**', ...(c.unresolved.length ? c.unresolved.map((u) => `- ${u}`) : ['- (nothing recorded as open)']))
  return lines
}

// The stored row body.
export function renderLifeChapterMarkdown(month: string, c: ChapterBody): string {
  return [`# ${monthLabel(month)} — ${c.title}`, '', ...bodyLines(c)].join('\n').trim()
}

// MCP / REST markdown (same renderer on both surfaces).
export function renderLifeChaptersMarkdown(views: readonly LifeChapterView[]): string {
  if (!views.length) return '# Life chapters\n\nNo chapter written yet.'
  return ['# Life chapters', ...views.flatMap((v) => ['', `## ${monthLabel(v.month)} — ${v.title}`, '', ...bodyLines(v)])].join('\n')
}

// The optional Telegram notice (mode 1 + KAIROS_LIFE_CHAPTER_LINE).
export function renderChapterNotice(month: string, c: Pick<ChapterBody, 'title' | 'summary'>): { title: string; message: string } {
  return {
    title: `Chapter · ${monthLabel(month)}`,
    message: `${c.title}\n\n${c.summary.trim()}\n\nAsk me for the full chapter.`,
  }
}

export const CHAPTER_CONTINUITY_MAX_CHARS = 600

// The reflect continuity block body (mode 1 only): title, summary and open
// threads, ≤600 chars. Context, never evidence — no ids, no lintHits.
export function renderChapterContinuity(c: Pick<LifeChapterMeta, 'month' | 'title' | 'summary' | 'unresolved'>): string {
  const lines = [`${monthLabel(c.month)} — ${c.title}`, c.summary.trim()]
  if (c.unresolved.length) lines.push(`Still open: ${c.unresolved.join('; ')}`)
  const out = neutraliseFences(lines.join('\n'))
  return out.length > CHAPTER_CONTINUITY_MAX_CHARS ? `${out.slice(0, CHAPTER_CONTINUITY_MAX_CHARS - 1)}…` : out
}
