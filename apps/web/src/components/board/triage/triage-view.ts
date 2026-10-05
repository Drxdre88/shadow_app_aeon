import { readCardTriage, type CardTriage, type TriageItemKind } from '@/lib/kairos/triage/types'

// What the card's "Vorath suggests" block shows: pending items that still
// make sense against the live card, plus duplicates the owner confirmed.

export interface TriageRowView {
  key: string
  kind: TriageItemKind
  ref: string
  title: string
  reason: string
  // Label rows carry the colour; priority rows the colour of that priority.
  color?: string
  accepted: boolean
  // Duplicate rows: the other card is loaded on this board (can be opened).
  openable?: boolean
}

export interface TriageCardLike {
  id: string
  priority: string
  labels: string[]
  metadata?: Record<string, unknown>
}

export interface TriageViewDeps {
  labels: ReadonlyArray<{ id: string; name: string; color: string }>
  priorities: ReadonlyArray<{ id: string; name: string; color: string }>
  taskNames: ReadonlyMap<string, string>
}

export function triageRows(card: TriageCardLike, deps: TriageViewDeps): TriageRowView[] {
  const triage: CardTriage | null = readCardTriage(card.metadata)
  if (!triage) return []
  const rows: TriageRowView[] = []
  for (const l of triage.labels) {
    if (l.status !== 'pending' || card.labels.includes(l.id)) continue
    const label = deps.labels.find((x) => x.id === l.id)
    if (!label) continue
    rows.push({ key: `label:${l.id}`, kind: 'label', ref: l.id, title: `Add label “${label.name}”`, reason: l.reason, color: label.color, accepted: false })
  }
  const p = triage.priority
  if (p && p.status === 'pending' && p.value !== card.priority) {
    const def = deps.priorities.find((x) => x.id === p.value)
    rows.push({ key: 'priority', kind: 'priority', ref: p.value, title: `Set priority to ${def?.name ?? p.value}`, reason: p.reason, color: def?.color, accepted: false })
  }
  for (const d of triage.duplicates) {
    if (d.status === 'dismissed' || d.taskId === card.id) continue
    const liveName = deps.taskNames.get(d.taskId)
    const name = liveName ?? d.name
    const accepted = d.status === 'accepted'
    rows.push({
      key: `duplicate:${d.taskId}`,
      kind: 'duplicate',
      ref: d.taskId,
      title: accepted ? `Marked as the same work as “${name}”` : `May be the same as “${name}”`,
      reason: d.reason,
      accepted,
      openable: liveName !== undefined,
    })
  }
  return rows
}
