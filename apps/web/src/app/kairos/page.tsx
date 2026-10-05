import { permanentRedirect } from 'next/navigation'

type SearchParams = Record<string, string | string[] | undefined>

export default async function KairosRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v)
  }
  const query = params.toString()
  permanentRedirect(query ? `/vorath?${query}` : '/vorath')
}
