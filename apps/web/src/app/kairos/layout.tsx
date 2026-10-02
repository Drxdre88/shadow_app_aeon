import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getWorkspaceProjects } from '@/lib/actions/projects'
import { ensurePersonalWorkspace } from '@/lib/actions/workspaces'
import { KairosShell } from '@/components/kairos/KairosShell'

// The Kairos chat server actions run on this route; with the chat routine on,
// their after() watchdog waits up to ~3 min and may then answer on the paid
// key. Mirrors the Telegram webhook (lib/kairos/chat-routine.ts).
export const maxDuration = 300

export default async function KairosLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!session.user.termsAccepted) redirect('/beta-terms')

  const workspaceData = await ensurePersonalWorkspace().then(() => getWorkspaceProjects())

  return (
    <KairosShell user={session.user} initialWorkspaces={workspaceData}>
      {children}
    </KairosShell>
  )
}
