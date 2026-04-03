import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

type Project = {
  id: string
  name: string
  description: string | null
  planetImage: string | null
  createdAt: string
  updatedAt: string
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.get<Project[]>('/projects'),
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => apiClient.get<Project>(`/projects/${id}`),
    enabled: !!id,
  })
}
