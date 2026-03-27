import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { acceptProjectInvite } from '@/lib/actions/members'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/invite/${token}`)
  }

  try {
    const projectId = await acceptProjectInvite(token)
    revalidatePath('/dashboard')
    redirect(`/project/${projectId}`)
  } catch {
    redirect('/dashboard?error=invite_invalid')
  }
}
