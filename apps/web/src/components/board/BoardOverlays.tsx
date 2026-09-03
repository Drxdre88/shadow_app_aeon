'use client'

import { DependencyGlowTree } from './DependencyGlowTree'
import { LabelPicker } from './LabelPicker'
import { TaskAssigneeOverlay } from './TaskAssigneeOverlay'
import { TaskColorPicker } from './TaskColorPicker'
import { TaskPriorityPicker } from './TaskPriorityPicker'
import { TaskProgressPopover } from './TaskProgressPopover'
import { TaskSizePopover } from './TaskSizePopover'
import type { BoardOverlayState, BoardTaskData } from './useBoardOverlays'

interface BoardOverlaysProps {
  projectId: string
  state: BoardOverlayState
  showAllDeps?: boolean
  onShowAllDepsChange?: (v: boolean) => void
  onTaskEdit: (taskId: string) => void
  onTaskUpdate?: (taskId: string, updates: Partial<BoardTaskData>, options?: { silent?: boolean }) => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void | boolean | Promise<void | boolean>
  onLabelUpdate?: (labelId: string, updates: { name?: string; color?: string }) => void
  onLabelDelete?: (labelId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
}

/**
 * The board's single-card overlays — assignees, progress, size, dependency
 * trees and the label/colour/priority pickers. Purely presentational wiring:
 * every piece of state lives in useBoardOverlays.
 */
export function BoardOverlays({
  projectId,
  state,
  showAllDeps,
  onShowAllDepsChange,
  onTaskEdit,
  onTaskUpdate,
  onLabelCreate,
  onLabelUpdate,
  onLabelDelete,
  onLabelToggle,
}: BoardOverlaysProps) {
  const {
    dependencyTreeTaskId, setDependencyTreeTaskId,
    labelPickerTaskId, setLabelPickerTaskId,
    colorPickerTaskId, setColorPickerTaskId,
    priorityPickerTaskId, setPriorityPickerTaskId,
    assigneeTaskId, setAssigneeTaskId,
    progressTaskId, setProgressTaskId,
    sizeTaskId, setSizeTaskId,
  } = state

  return (
    <>
      <TaskAssigneeOverlay
        projectId={projectId}
        taskId={assigneeTaskId}
        onClose={() => setAssigneeTaskId(null)}
      />

      {progressTaskId && (
        <TaskProgressPopover
          taskId={progressTaskId}
          onClose={() => setProgressTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {sizeTaskId && (
        <TaskSizePopover
          taskId={sizeTaskId}
          onClose={() => setSizeTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {dependencyTreeTaskId && (
        <DependencyGlowTree
          taskId={dependencyTreeTaskId}
          onClose={() => setDependencyTreeTaskId(null)}
          onTaskEdit={(id) => { setDependencyTreeTaskId(null); onTaskEdit(id) }}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {showAllDeps && (
        <DependencyGlowTree
          taskId={null}
          showAll
          onClose={() => onShowAllDepsChange?.(false)}
          onTaskEdit={(id) => { onShowAllDepsChange?.(false); onTaskEdit(id) }}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {labelPickerTaskId && (
        <LabelPicker
          taskId={labelPickerTaskId}
          projectId={projectId}
          isOpen={!!labelPickerTaskId}
          onClose={() => setLabelPickerTaskId(null)}
          onLabelCreate={onLabelCreate}
          onLabelUpdate={onLabelUpdate}
          onLabelDelete={onLabelDelete}
          onLabelToggle={onLabelToggle}
        />
      )}

      {colorPickerTaskId && (
        <TaskColorPicker
          taskId={colorPickerTaskId}
          isOpen={!!colorPickerTaskId}
          onClose={() => setColorPickerTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {priorityPickerTaskId && (
        <TaskPriorityPicker
          taskId={priorityPickerTaskId}
          isOpen={!!priorityPickerTaskId}
          onClose={() => setPriorityPickerTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}
    </>
  )
}
