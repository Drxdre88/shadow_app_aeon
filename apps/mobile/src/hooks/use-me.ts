import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

type User = {
  id: string
  name: string | null
  email: string
  role: string
  image: string | null
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiClient.get<User>('/me'),
    staleTime: 5 * 60_000,
  })
}
