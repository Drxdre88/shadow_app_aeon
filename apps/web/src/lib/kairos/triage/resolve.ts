import type { CardTriage, TriageItemKind, TriageItemStatus } from './types'

// Pure owner decisions on a stored triage: find an item, flip its status.

export type TriageItem =
  | { kind: 'label'; ref: string; reason: string; status: TriageItemStatus }
  | { kind: 'priority'; ref: string; reason: string; status: TriageItemStatus }
  | { kind: 'duplicate'; ref: string; name: string; reason: string; status: TriageItemStatus }

export function triageItems(t: CardTriage): TriageItem[] {
  const items: TriageItem[] = []
  for (const l of t.labels) items.push({ kind: 'label', ref: l.id, reason: l.reason, status: l.status })
  if (t.priority) items.push({ kind: 'priority', ref: t.priority.value, reason: t.priority.reason, status: t.priority.status })
  for (const d of t.duplicates) items.push({ kind: 'duplicate', ref: d.taskId, name: d.name, reason: d.reason, status: d.status })
  return items
}

export function findTriageItem(t: CardTriage, kind: TriageItemKind, ref: string | undefined): TriageItem | null {
  return triageItems(t).find((i) => i.kind === kind && (kind === 'priority' || i.ref === ref)) ?? null
}

// A copy with the item's status set, or null when the item is missing or
// already decided (a second click, or another tab got there first).
export function withTriageStatus(
  t: CardTriage,
  kind: TriageItemKind,
  ref: string | undefined,
  status: Exclude<TriageItemStatus, 'pending'>,
): CardTriage | null {
  const item = findTriageItem(t, kind, ref)
  if (!item || item.status !== 'pending') return null
  if (kind === 'priority') return t.priority ? { ...t, priority: { ...t.priority, status } } : null
  if (kind === 'label') return { ...t, labels: t.labels.map((l) => (l.id === ref ? { ...l, status } : l)) }
  return { ...t, duplicates: t.duplicates.map((d) => (d.taskId === ref ? { ...d, status } : d)) }
}

export function hasPendingTriage(t: CardTriage | null): boolean {
  return !!t && triageItems(t).some((i) => i.status === 'pending')
}
