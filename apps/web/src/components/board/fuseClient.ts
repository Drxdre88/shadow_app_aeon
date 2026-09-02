import { useBoardStore, type BoardTask, type ChecklistPreviewItem, type ChecklistSummary, type TaskAssigneePill } from '@/lib/store/boardStore'
import { mergeTaskFields, unionIds, repointDependencies } from '@/lib/data/fuseRules'

// Client half of card fusion: the optimistic merge the board shows the
// instant the operator confirms, and the slice of store state needed to put
// it back (a failed action, or the toast's Undo). The rules are the shared
// ones in lib/data/fuseRules, so the preview matches what the server lands.

type StoreState = ReturnType<typeof useBoardStore.getState>
type Dependency = StoreState['dependencies'][number]

export interface FuseStoreSlice {
  sourceTask: BoardTask
  survivorTask: BoardTask
  dependencies: Dependency[]
  assignees: Record<string, TaskAssigneePill[] | undefined>
  summaries: Record<string, ChecklistSummary | undefined>
  previews: Record<string, ChecklistPreviewItem[] | undefined>
}

export function captureFuseSlice(state: StoreState, sourceId: string, survivorId: string): FuseStoreSlice | null {
  const sourceTask = state.tasks.find((t) => t.id === sourceId)
  const survivorTask = state.tasks.find((t) => t.id === survivorId)
  if (!sourceTask || !survivorTask) return null
  return {
    sourceTask: { ...sourceTask },
    survivorTask: { ...survivorTask },
    dependencies: state.dependencies.map((d) => ({ ...d })),
    assignees: { [sourceId]: state.assigneesByTask[sourceId], [survivorId]: state.assigneesByTask[survivorId] },
    summaries: { [sourceId]: state.checklistSummaries[sourceId], [survivorId]: state.checklistSummaries[survivorId] },
    previews: { [sourceId]: state.checklistPreviews[sourceId], [survivorId]: state.checklistPreviews[survivorId] },
  }
}

function sumSummaries(a?: ChecklistSummary, b?: ChecklistSummary): ChecklistSummary | undefined {
  if (!a && !b) return undefined
  return {
    checked: (a?.checked ?? 0) + (b?.checked ?? 0),
    crossed: (a?.crossed ?? 0) + (b?.crossed ?? 0),
    total: (a?.total ?? 0) + (b?.total ?? 0),
  }
}

function unionPills(survivor: TaskAssigneePill[] = [], source: TaskAssigneePill[] = []): TaskAssigneePill[] {
  const seen = new Set(survivor.map((p) => p.userId))
  return [...survivor, ...source.filter((p) => !seen.has(p.userId))]
}

/** Apply the merge to the store as the server will: survivor absorbs, source vanishes. */
export function applyFuseOptimistic(slice: FuseStoreSlice, name: string) {
  const { sourceTask, survivorTask } = slice
  const patch = mergeTaskFields(survivorTask, sourceTask, name)
  const state = useBoardStore.getState()
  state.updateTask(survivorTask.id, {
    ...patch,
    description: patch.description ?? undefined,
    startDate: patch.startDate ?? undefined,
    endDate: patch.endDate ?? undefined,
    labels: unionIds(survivorTask.labels, sourceTask.labels),
  })
  state.removeTask(sourceTask.id)

  const sourceEdges = state.dependencies.filter((d) => d.blockerTaskId === sourceTask.id || d.blockedTaskId === sourceTask.id)
  const survivorEdges = state.dependencies.filter((d) => d.blockerTaskId === survivorTask.id || d.blockedTaskId === survivorTask.id)
  const inserts = repointDependencies(sourceEdges, survivorEdges, sourceTask.id, survivorTask.id)
  useBoardStore.setState((s) => {
    const { [sourceTask.id]: _srcPills, ...assignees } = s.assigneesByTask
    const { [sourceTask.id]: _srcSummary, ...summaries } = s.checklistSummaries
    const { [sourceTask.id]: _srcPreview, ...previews } = s.checklistPreviews
    const mergedSummary = sumSummaries(s.checklistSummaries[survivorTask.id], s.checklistSummaries[sourceTask.id])
    const mergedPreview = [...(s.checklistPreviews[survivorTask.id] ?? []), ...(s.checklistPreviews[sourceTask.id] ?? [])]
    return {
      dependencies: [
        ...s.dependencies.filter((d) => d.blockerTaskId !== sourceTask.id && d.blockedTaskId !== sourceTask.id),
        ...inserts,
      ],
      assigneesByTask: { ...assignees, [survivorTask.id]: unionPills(s.assigneesByTask[survivorTask.id], s.assigneesByTask[sourceTask.id]) },
      checklistSummaries: mergedSummary ? { ...summaries, [survivorTask.id]: mergedSummary } : summaries,
      checklistPreviews: mergedPreview.length > 0 ? { ...previews, [survivorTask.id]: mergedPreview } : previews,
    }
  })
}

/** Put the captured slice back — used on failure and on Undo. */
export function restoreFuseSlice(slice: FuseStoreSlice) {
  const { sourceTask, survivorTask } = slice
  useBoardStore.setState((s) => {
    const withoutSource = s.tasks.filter((t) => t.id !== sourceTask.id)
    const tasks = withoutSource.some((t) => t.id === survivorTask.id)
      ? withoutSource.map((t) => (t.id === survivorTask.id ? { ...survivorTask } : t))
      : [...withoutSource, { ...survivorTask }]
    const restoreMap = <V,>(current: Record<string, V>, saved: Record<string, V | undefined>) => {
      const next = { ...current }
      for (const [id, value] of Object.entries(saved)) {
        if (value === undefined) delete next[id]
        else next[id] = value
      }
      return next
    }
    return {
      tasks: [...tasks, { ...sourceTask }],
      dependencies: slice.dependencies.map((d) => ({ ...d })),
      assigneesByTask: restoreMap(s.assigneesByTask, slice.assignees),
      checklistSummaries: restoreMap(s.checklistSummaries, slice.summaries),
      checklistPreviews: restoreMap(s.checklistPreviews, slice.previews),
      isDirty: true,
      lastMutatedAt: Date.now(),
    }
  })
}

/** Replace the optimistic scalars with the row the server actually wrote. */
export function applyFuseResult(survivor: {
  id: string
  name: string
  description: string | null
  priority: string
  startDate: Date | string | null
  endDate: Date | string | null
  onTimeline: boolean
  size: number | null
  updatedAt: Date | string
}, labelIds: string[]) {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : undefined)
  useBoardStore.getState().updateTask(survivor.id, {
    name: survivor.name,
    description: survivor.description ?? undefined,
    priority: survivor.priority as BoardTask['priority'],
    startDate: iso(survivor.startDate),
    endDate: iso(survivor.endDate),
    onTimeline: survivor.onTimeline,
    size: survivor.size,
    updatedAt: iso(survivor.updatedAt),
    labels: labelIds,
  })
}
