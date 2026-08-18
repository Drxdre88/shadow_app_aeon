import { pointerWithin, rectIntersection, closestCenter, type CollisionDetection } from '@dnd-kit/core'

// Pointer-first collision detection: anywhere inside a column counts as a hit,
// including its empty area and the gaps between cards, so a release there can
// never come back empty. Falls back to rect overlap and then centre distance
// for keyboard drags, which have no pointer coordinates.
export const boardCollisionDetection: CollisionDetection = (args) => {
  const isColumnDrag = args.active.data.current?.type === 'column'
  const droppableContainers = isColumnDrag
    ? args.droppableContainers.filter((c) => c.data.current?.type === 'column')
    : args.droppableContainers

  const scoped = { ...args, droppableContainers }

  const pointerCollisions = pointerWithin(scoped)
  if (pointerCollisions.length > 0) return pointerCollisions

  const rectCollisions = rectIntersection(scoped)
  if (rectCollisions.length > 0) return rectCollisions

  return closestCenter(scoped)
}
