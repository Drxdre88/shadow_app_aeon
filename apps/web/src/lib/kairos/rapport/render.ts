import type { KairosRapportView } from '@/lib/data/validators/kairos-rapport'

// Markdown for get_kairos_rapport / GET /api/v1/kairos/rapport (format
// "markdown"). Pure; both surfaces call it on the same view.

const day = (iso: string): string => iso.slice(0, 16).replace('T', ' ')
const kinds = (byKind: Record<string, number>): string =>
  Object.entries(byKind).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(', ')

export function renderRapportMarkdown(view: KairosRapportView): string {
  const lines: string[] = ['# Vorath rapport', '']
  lines.push(`Flags: readiness ${view.flags.readiness}, bids ${view.flags.bids}, repair ${view.flags.repair}.`)
  const r = view.rupture
  lines.push('', '## Rupture / repair')
  lines.push(`State: ${r.state} since ${day(r.since)}${r.reason ? ` (${r.reason})` : ''}; cooldown ${r.cooldownH}h.`)
  if (r.lastRepairAt) lines.push(`Last repair: ${day(r.lastRepairAt)}.`)
  const soft = kinds(r.soft72h)
  lines.push(`Soft signals, last 72h: ${soft || 'none'}.`)
  lines.push('', '## Readiness by goal')
  if (view.goals.length === 0) lines.push('(no goal talk yet)')
  for (const g of view.goals) {
    const tip = g.lastTip ? `; last tip ${g.lastTip.kind} ${day(g.lastTip.at)}` : ''
    lines.push(`- ${g.title}: ${g.band}, balance ${g.balance}${tip}`)
  }
  lines.push('', '## Small bids (30 days)')
  lines.push(view.bids30d.count ? `${view.bids30d.count} (${kinds(view.bids30d.byKind)})` : 'none')
  lines.push('', '## Reply length')
  lines.push(`${view.turns.n} turns; recent ~${view.turns.lenEwma} words, baseline ~${view.turns.baseline} words; terse run ${view.turns.terseRun}.`)
  return lines.join('\n')
}
