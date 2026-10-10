import { notFound, permanentRedirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { canUseVorath } from '@/lib/vorath-access'

type SearchParams = Record<string, string | string[] | undefined>

export default async function KairosRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth()
  if (!canUseVorath(session?.user?.id)) notFound()
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v)
  }
  const query = params.toString()
  permanentRedirect(query ? `/vorath?${query}` : '/vorath')
}
