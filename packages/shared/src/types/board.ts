type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface BoardColumn {
  id: string
  projectId: string
  name: string
  color: string
  icon?: string | null
  orderIndex: number
}

export interface BoardTask {
  id: string
  projectId: string
  name: string
  description?: string
  columnId?: string
  status: string
  priority: Priority
  color: string
  labels: string[]
  startDate?: string
  endDate?: string
  onTimeline: boolean
  ganttTaskId?: string | null
  size?: number | null
  updatedAt?: string
  orderIndex: number
}

export interface ChecklistSummary {
  checked: number
  crossed: number
  total: number
}
