import type { Project } from '@/lib/db/schema'

export interface ProjectWithStats extends Project {
  totalTasks: number
  doneTasks: number
  completionPct: number
}
