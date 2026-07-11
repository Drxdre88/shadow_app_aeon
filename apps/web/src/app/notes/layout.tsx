import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getWorkspaceProjects } from '@/lib/actions/projects'
import { ensurePersonalWorkspace } from '@/lib/actions/workspaces'
import { KairosShell } from '@/components/kairos/KairosShell'

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')

  const workspaceData = await ensurePersonalWorkspace().then(() => getWorkspaceProjects())

  return (
    <KairosShell user={session.user} initialWorkspaces={workspaceData}>
      <div className="h-full w-full overflow-hidden bg-black text-white/90">
        {children}
      </div>
    </KairosShell>
  )
}
