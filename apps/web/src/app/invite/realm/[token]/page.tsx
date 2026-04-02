import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { acceptRealmInvite } from '@/lib/actions/workspaces'

const TOKEN_RE = /^[0-9a-f]{64}$/

export default async function RealmInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!TOKEN_RE.test(token)) {
    redirect('/dashboard?error=invite_invalid')
  }

  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/invite/realm/${encodeURIComponent(token)}`)
  }

  if (!session.user.termsAccepted) redirect('/beta-terms')

  try {
    await acceptRealmInvite(token)
    revalidatePath('/dashboard')
    redirect('/dashboard')
  } catch {
    redirect('/dashboard?error=invite_invalid')
  }
}
