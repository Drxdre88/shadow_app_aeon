export interface TaskCardTask {
  id: string
  name: string
  description?: string
  status: string
  color: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  labels: string[]
  startDate?: string
  endDate?: string
  onTimeline: boolean
  size?: number | null
  progress?: number | null
  updatedAt?: string
  metadata?: Record<string, unknown>
}
