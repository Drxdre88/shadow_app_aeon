import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProjectsWithStats, getWorkspaceProjects, getSharedProjects } from '@/lib/actions/projects'
import { ensurePersonalWorkspace } from '@/lib/actions/workspaces'
import DashboardContent from './DashboardContent'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')

  const [projects, workspaceData, sharedData] = await Promise.all([
    getProjectsWithStats(),
    ensurePersonalWorkspace().then(() => getWorkspaceProjects()),
    getSharedProjects(),
  ])

  return (
    <DashboardContent
      user={session.user}
      projects={projects}
      initialWorkspaces={workspaceData}
      initialShared={sharedData}
    />
  )
}
