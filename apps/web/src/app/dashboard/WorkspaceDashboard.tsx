import type { ProjectWithStats } from '@/components/project/types'

export interface WorkspaceGroup {
  groupId: string
  groupName: string
  groupColor: string
  groupIcon: string | null
  isPersonal: boolean
  memberCount: number
  isOwner: boolean
  projects: ProjectWithStats[]
}
