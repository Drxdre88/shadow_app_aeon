import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProjectsWithStats } from '@/lib/actions/projects'
import DashboardContent from './DashboardContent'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')


  const projects = await getProjectsWithStats()

  return <DashboardContent user={session.user} projects={projects} />
}
