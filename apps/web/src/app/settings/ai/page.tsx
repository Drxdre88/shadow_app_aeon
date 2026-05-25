import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { fetchCredentials, fetchPreferences } from '@/lib/actions/ai-credentials'
import BYOKEntryScreen from './BYOKEntryScreen'

export const dynamic = 'force-dynamic'

export default async function AiSettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const isAdmin = session.user.role === 'admin'

  // Non-admins land on the gated entry screen — no credential fetch (the
  // data layer guards reject non-admins, so calling those would throw).
  if (!isAdmin) {
    return <BYOKEntryScreen isAdmin={false} initialCredentials={null} initialPreferences={null} />
  }

  const [credentials, preferences] = await Promise.all([
    fetchCredentials(),
    fetchPreferences(),
  ])

  return (
    <BYOKEntryScreen
      isAdmin
      initialCredentials={credentials}
      initialPreferences={preferences}
    />
  )
}
