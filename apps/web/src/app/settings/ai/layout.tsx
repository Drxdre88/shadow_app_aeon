import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getWorkspaceProjects } from '@/lib/actions/projects'
import { ensurePersonalWorkspace } from '@/lib/actions/workspaces'
import { KairosShell } from '@/components/kairos/KairosShell'

// KairosShell hosts the Kairos chat here too; its server actions' after()
// watchdog needs the same budget as /kairos (see app/kairos/layout.tsx).
export const maxDuration = 300

export default async function AiSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')

  const workspaceData = await ensurePersonalWorkspace().then(() => getWorkspaceProjects())

  return (
    <KairosShell user={session.user} initialWorkspaces={workspaceData}>
      <div className="h-full w-full overflow-y-auto">{children}</div>
    </KairosShell>
  )
}
