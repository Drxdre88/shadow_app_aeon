import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getWorkspaceProjects } from '@/lib/actions/projects'
import { ensurePersonalWorkspace } from '@/lib/actions/workspaces'
import { findDominionsByUser } from '@/lib/data/dominions'
import { KairosShell } from '@/components/kairos/KairosShell'

export default async function KairosLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')

  const [workspaceData, dominions] = await Promise.all([
    ensurePersonalWorkspace().then(() => getWorkspaceProjects()),
    findDominionsByUser(session.user.id),
  ])
  const dominionOptions = dominions
    .filter((d) => !d.archivedAt)
    .map((d) => ({ id: d.id, name: d.name }))

  return (
    <KairosShell user={session.user} initialWorkspaces={workspaceData} dominions={dominionOptions}>
      {children}
    </KairosShell>
  )
}
