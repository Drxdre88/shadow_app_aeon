import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

type Realm = {
  id: string
  name: string
  color: string
  icon: string | null
  isPersonal: boolean
  role: string
}

export function useRealms() {
  return useQuery({
    queryKey: ['realms'],
    queryFn: () => apiClient.get<Realm[]>('/realms'),
  })
}
