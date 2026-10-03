import type { KairosSurpriseView } from '@/lib/data/validators/kairos-surprise'

// Markdown for get_kairos_surprise / GET /api/v1/kairos/surprise (format
// "markdown"). Pure; both surfaces call it on the same view.

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()

export function renderSurpriseMarkdown(view: KairosSurpriseView): string {
  const lines: string[] = ['# Kairos surprise', '']
  const kinds = Object.entries(view.last7d.byKind)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ${n}`)
  lines.push(`Last 7 days: ${view.last7d.count} events, total surprise ${fmt(view.last7d.sumS)}${kinds.length ? ` (${kinds.join(', ')})` : ''}.`)
  lines.push('', '## Recent events')
  if (view.events.length === 0) lines.push('(none)')
  for (const e of view.events) {
    const credit = e.credited ? `, credited +${e.credited.pos}/−${e.credited.neg}` : ''
    lines.push(`- ${e.at.slice(0, 16).replace('T', ' ')} ${e.kind} s=${fmt(e.s)} — beliefs ${e.beliefs}, memories ${e.memories}, opened ${e.opened}${credit}`)
  }
  lines.push('', '## Learning progress')
  if (!view.lp || view.lp.areas.length === 0) lines.push('(not computed)')
  else {
    lines.push(`computed ${view.lp.computedAt.slice(0, 10)}`)
    for (const a of view.lp.areas) lines.push(`- ${a.key}: lp ${fmt(a.lp)}, recent Brier ${fmt(a.brierNew)} (n ${a.nNew}/${a.nOld})`)
  }
  lines.push('', '## Replay')
  if (!view.replay) lines.push('(none yet)')
  else {
    const hits = view.replay.prevHits === undefined ? '' : `; ${view.replay.prevHits} of the previous night's set cited`
    lines.push(`night ${view.replay.night}: ${view.replay.ids.length} memories${hits}`)
  }
  return lines.join('\n')
}
