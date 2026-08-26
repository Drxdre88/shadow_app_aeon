import type { ChecklistItem } from './types'

/**
 * Stable display order for checklist groups.
 *
 * Group order used to be derived purely from the items array (first-seen order
 * by orderIndex) with locally-created empty ("ghost") groups appended at the
 * end. That derivation has no anchor for empty groups: committing the first
 * item to a lower group promoted it into the item-derived block and it jumped
 * above the still-empty groups created before it (live-reported "checklist
 * groups rearrange themselves" bug).
 *
 * `memory` is the order in which groups were first DISPLAYED this mount (plus
 * any explicit user reorder/rename edits). Every group that still exists keeps
 * its memorized slot; genuinely new groups are appended in the order they
 * appear (item-derived first, then pending ghosts).
 */
export function mergeGroupOrder(
  memory: string[],
  itemGroups: string[],
  pendingGroups: string[],
): string[] {
  const current: string[] = []
  const currentSet = new Set<string>()
  for (const g of [...itemGroups, ...pendingGroups]) {
    if (!currentSet.has(g)) {
      currentSet.add(g)
      current.push(g)
    }
  }
  const ordered: string[] = []
  const orderedSet = new Set<string>()
  for (const g of memory) {
    if (currentSet.has(g) && !orderedSet.has(g)) {
      orderedSet.add(g)
      ordered.push(g)
    }
  }
  for (const g of current) {
    if (!orderedSet.has(g)) {
      orderedSet.add(g)
      ordered.push(g)
    }
  }
  return ordered
}

/** Append `additions` (names not yet memorized) to the group-order memory. */
export function extendGroupOrderMemory(memory: string[], displayGroups: string[]): string[] {
  const seen = new Set(memory)
  const additions = displayGroups.filter((g) => !seen.has(g))
  return additions.length === 0 ? memory : [...memory, ...additions]
}

/**
 * Compute the optimistic item arrangement for an add, honoring the on-screen
 * group order, plus the server reindex needed to make persisted orderIndex
 * match it.
 *
 * The server appends new items at MAX(orderIndex)+1, so an item added to a
 * group that is not displayed last would land — and after reload, drag its
 * whole group — below groups displayed after it. When the new item's true
 * position is not the global end, `reindex` carries a full contiguous rewrite
 * (in display order) to enqueue after the create; when the append already
 * matches the display order, `reindex` is null and no extra write is needed.
 */
export function arrangeItemAdd(
  items: ChecklistItem[],
  newItem: ChecklistItem,
  orderedGroups?: string[],
): { next: ChecklistItem[]; reindex: { id: string; orderIndex: number }[] | null } {
  const appended = [...items, newItem]
  if (!orderedGroups || orderedGroups.length === 0) {
    return { next: appended, reindex: null }
  }
  const order: string[] = []
  const orderSet = new Set<string>()
  for (const g of orderedGroups) {
    if (!orderSet.has(g)) {
      orderSet.add(g)
      order.push(g)
    }
  }
  const next = [
    ...order.flatMap((g) => appended.filter((i) => i.groupName === g)),
    // Safety net: items in groups the caller didn't list keep their relative
    // order at the end rather than vanishing.
    ...appended.filter((i) => !orderSet.has(i.groupName)),
  ]
  if (next[next.length - 1]?.id === newItem.id) {
    // Append order already matches the display order — per-group sequences and
    // group first-seen order are unchanged, so the server's MAX+1 is correct.
    return { next, reindex: null }
  }
  return { next, reindex: next.map((i, idx) => ({ id: i.id, orderIndex: idx })) }
}
