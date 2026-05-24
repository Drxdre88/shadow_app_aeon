import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { fetchCredentials, fetchPreferences } from '@/lib/actions/ai-credentials'
import AiSettingsClient from './AiSettingsClient'

export const dynamic = 'force-dynamic'

export default async function AiSettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  if (session.user.role !== 'admin') notFound()

  const [credentials, preferences] = await Promise.all([
    fetchCredentials(),
    fetchPreferences(),
  ])

  return <AiSettingsClient initialCredentials={credentials} initialPreferences={preferences} />
}
