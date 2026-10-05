import type { KairosOwnerModelView, OwnerItemView } from '@/lib/data/validators/kairos-owner-model'

// Markdown for get_kairos_owner_model / GET /api/v1/kairos/owner-model
// (format "markdown"). Pure; both surfaces call it on the same view.

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')

function line(v: OwnerItemView): string {
  const dates = v.kind === 'state'
    ? `since ${day(v.firstSeenAt)}, ${v.status === 'expired' ? 'lapsed' : 'lapses'} ${day(v.expiresAt)}`
    : `confirmed ${day(v.lastConfirmedAt)}`
  const tags = [v.ownerWorded ? 'his words' : null, v.longRunning ? 'long-running' : null].filter(Boolean)
  return `- C${v.seq} ${v.kind}: ${v.text} (${dates}; ${v.confirmations} confirmation${v.confirmations === 1 ? '' : 's'}${tags.length ? `; ${tags.join(', ')}` : ''})`
}

function section(title: string, items: readonly OwnerItemView[]): string[] {
  return ['', `## ${title}`, ...(items.length ? items.map(line) : ['(none)'])]
}

export function renderOwnerModelMarkdown(view: KairosOwnerModelView): string {
  const byAction = Object.entries(view.corrections.byAction).map(([k, n]) => `${k} ${n}`).join(', ')
  const card = view.lastCard
    ? `Last card: ${view.lastCard.isoWeek} ${view.lastCard.status} (${view.lastCard.items} items, ${view.lastCard.at.slice(0, 16).replace('T', ' ')}).`
    : 'Last card: none yet.'
  return [
    "# What Vorath thinks he's carrying",
    '',
    card,
    `Corrections (30 days): ${view.corrections.last30d}${byAction ? ` (${byAction})` : ''}. Active vetoes: ${view.vetoes}.`,
    ...section('Live', view.live),
    ...section('Candidates (unconfirmed traits)', view.candidates),
    ...section('Expired states', view.expired),
    ...section('Closed', view.closed),
  ].join('\n')
}
