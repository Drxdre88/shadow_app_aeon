import type { GateCellView, KairosGateView } from '@/lib/data/validators/kairos-gate'

// Markdown for get_kairos_gate / GET /api/v1/kairos/gate (format "markdown").
// Pure; both surfaces call it on the same view.

const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`)
const cell = (c: GateCellView) => `n ${c.n}, replied ${pct(c.replyRate)}, latency ${c.avgLatencyMin === null ? '–' : `${c.avgLatencyMin} min`}, warmth ${c.warmth ?? '–'}`

function block(lines: string[], title: string, rec: Record<string, GateCellView>): void {
  lines.push('', `## By ${title}`)
  const entries = Object.entries(rec)
  if (entries.length === 0) lines.push('(none)')
  for (const [k, c] of entries) lines.push(`- ${k}: ${cell(c)}`)
}

export function renderGateMarkdown(view: KairosGateView): string {
  const l = view.limits
  const lines: string[] = ['# Vorath gate', '']
  lines.push(`Gate ${view.mode}, receptivity ${view.receptivityMode}. Max hold ${l.maxHoldMin} min; quiet ${l.quietMin} min; chat quiet ${l.chatQuietMin} min; away ${l.awayMin} min.`)
  lines.push('', '## Held')
  if (view.held.length === 0) lines.push('(none)')
  for (const h of view.held) lines.push(`- ${h.title} — held ${h.heldAt?.slice(0, 16).replace('T', ' ') ?? '?'} (${h.reason ?? '?'}), until ${h.until?.slice(0, 16).replace('T', ' ') ?? '?'}`)

  const r = view.receptivity
  lines.push('', '## Receptivity', `Folded through ${r.foldedThrough?.slice(0, 16).replace('T', ' ') ?? '(never)'}. Overall: ${cell(r.global)}.`)
  lines.push('', '## By London hour')
  if (r.hours.length === 0) lines.push('(none)')
  for (const h of r.hours) lines.push(`- ${String(h.hour).padStart(2, '0')}:00: ${cell(h)}${h.cold ? ' — cold' : ''}`)
  block(lines, 'weekday (0 = Sunday)', r.dow)
  block(lines, 'kind', r.kind)
  block(lines, 'source', r.source)
  block(lines, 'break', r.breakType)
  const channels = Object.entries(r.replyChannel).map(([k, n]) => `${k} ${n}`)
  lines.push('', `Replies by channel: ${channels.length ? channels.join(', ') : '(none)'}`)

  lines.push('', '## Recent decisions')
  if (view.log.length === 0) lines.push('(none)')
  for (const e of view.log) lines.push(`- ${e.at.slice(0, 16).replace('T', ' ')} ${e.mode} ${e.decision} ${e.reason}${e.cold ? ' (cold hour)' : ''}`)
  return lines.join('\n')
}
