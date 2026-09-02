/**
 * Placement for "move every card in a column to the end of another column".
 * Shared by the data layer (against DB rows) and the board store (optimistic
 * update) so both sides land the cards in the same slots.
 */
export function planMoveAllToColumn<T extends { id: string; orderIndex: number }>(
  sourceTasks: readonly T[],
  targetMaxOrderIndex: number,
): { id: string; orderIndex: number }[] {
  return [...sourceTasks]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((t, i) => ({ id: t.id, orderIndex: targetMaxOrderIndex + 1 + i }))
}

export function maxOrderIndex(tasks: readonly { orderIndex: number }[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.orderIndex), -1)
}
