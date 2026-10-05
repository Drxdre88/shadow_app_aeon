import { TAIL_LINE_MAX_CHARS } from '@/lib/kairos/daily-message-tail'
import { isLondonMonday } from './london'
import { levelLabel } from './statement'
import type { KairosTrustView, TrustArea } from './types'

// Owner-facing renders of the trust view: MCP/REST markdown, the chat footer
// (stripped from history before any prompt) and the Monday 06:00 tail line.

export const TRUST_FOOTER_PREFIX = '⚖️ '
export const TRUST_TAIL_MAX_AREAS = 3
const FOOTER_RE = /\n*⚖️ On [^\n]*\s*$/u

export function buildTrustFooter(area: Pick<TrustArea, 'label' | 'statement'>): string {
  return `${TRUST_FOOTER_PREFIX}On ${area.label}: ${area.statement}`
}

// Pure: removes one trailing trust footer; anything else is returned as is.
export function stripTrustFooter(content: string): string {
  if (!content.includes(TRUST_FOOTER_PREFIX)) return content
  const stripped = content.replace(FOOTER_RE, '')
  return stripped === content ? content : stripped.trimEnd()
}

export const hasTrustFooterFor = (content: string, label: string): boolean =>
  content.includes(`${TRUST_FOOTER_PREFIX}On ${label}: `)

// Mondays (London) only; up to three areas with a level, most-settled first.
export function buildTrustTailLine(view: Pick<KairosTrustView, 'areas'>, now: Date): string | null {
  if (!isLondonMonday(now)) return null
  const known = view.areas.filter((a) => a.level !== 'unknown').slice(0, TRUST_TAIL_MAX_AREAS)
  if (known.length === 0) return null
  const items = known.map((a) => `${a.label}: ${levelLabel(a.level)} (${a.scored.right}/${a.scored.n})`)
  for (let k = items.length; k > 0; k -= 1) {
    const line = `${TRUST_FOOTER_PREFIX}How far to trust me: ${items.slice(0, k).join(' · ')}`
    if (line.length <= TAIL_LINE_MAX_CHARS) return line
  }
  return null
}

function areaLines(a: TrustArea): string[] {
  const lines = [`## ${a.label} — ${levelLabel(a.level)}`, a.statement, '']
  lines.push(`- Scored: ${a.scored.right} of ${a.scored.n} right · reliability ${a.scored.reliability} · 80% lower bound ${a.scored.lowerBound}`)
  if (a.calls) {
    lines.push(`- My calls: ${a.calls.right}/${a.calls.n} right · stated ${Math.round(a.calls.meanProbability * 100)}% · Brier ${a.calls.brier} · over-confidence ${a.calls.overconfidence >= 0 ? '+' : ''}${a.calls.overconfidence}`)
  }
  if (a.wentAhead.n > 0) lines.push(`- Kept a plan I doubted: ${a.wentAhead.n} (you right ${a.wentAhead.ownerRight}, me right ${a.wentAhead.kairosRight})`)
  if (a.kind === 'dominion') {
    const g = a.goals
    if (g.taken + g.vetoed > 0) lines.push(`- Goals: taken ${g.taken} · landed ${g.landed} · missed ${g.missed} · vetoed ${g.vetoed} (vetoes not scored)`)
    if (a.promises.kept + a.promises.missed > 0) lines.push(`- Goal promises: kept ${a.promises.kept} · missed ${a.promises.missed}`)
    if (a.ideas.accepted + a.ideas.dismissed > 0) lines.push(`- Ideas (display only, not scored): accepted ${a.ideas.accepted} · dismissed ${a.ideas.dismissed}`)
    if (a.corrections7d > 0) lines.push(`- Your corrections, last 7 days (display only): ${a.corrections7d}`)
  }
  lines.push('')
  return lines
}

export function renderTrustMarkdown(view: KairosTrustView): string {
  const lines = [
    '# How far to trust Vorath, per area',
    '',
    `_Last ${view.windowDays} days · computed on read · a level needs ${view.minN} settled · trust: ${view.mode.trust} · ask first: ${view.mode.askFirst}_`,
    '',
  ]
  if (view.missing.length > 0) lines.push(`_Could not read: ${view.missing.join(', ')}_`, '')
  if (view.areas.length === 0) lines.push('Nothing settled yet.', '')
  for (const a of view.areas) lines.push(...areaLines(a))
  if (view.corrections7d > 0) lines.push(`_Your corrections in the last 7 days, all areas (display only): ${view.corrections7d}_`)
  return lines.join('\n').trimEnd()
}
