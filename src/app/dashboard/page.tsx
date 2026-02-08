import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getProjects } from '@/lib/actions/projects'
import DashboardContent from './DashboardContent'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const projects = await getProjects()

  return <DashboardContent user={session.user} projects={projects} />
}
