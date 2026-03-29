export interface GanttTask {
  id: string
  projectId: string
  rowId: string | null
  name: string
  description?: string
  startDate: string
  endDate: string
  color: string
  progress: number
  dependencies: string[]
  boardTaskId?: string | null
}

export interface GanttRow {
  id: string
  projectId: string
  ganttViewId?: string | null
  name: string
  color: string
  orderIndex: number
}

export interface GanttView {
  id: string
  projectId: string
  name: string
  groupBy: string
  filters: Record<string, unknown>
}
