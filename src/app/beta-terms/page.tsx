import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import BetaTermsContent from './BetaTermsContent'

export default async function BetaTermsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.termsAccepted) redirect('/dashboard')

  return <BetaTermsContent />
}
