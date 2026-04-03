import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { BoardColumn, BoardTask } from '@aeon/shared'

type BoardData = {
  columns: BoardColumn[]
  tasks: BoardTask[]
}

export function useBoard(projectId: string) {
  return useQuery({
    queryKey: ['board', projectId],
    queryFn: async () => {
      const [columns, tasks] = await Promise.all([
        apiClient.get<BoardColumn[]>(`/projects/${projectId}/columns`),
        apiClient.get<BoardTask[]>(`/projects/${projectId}/tasks`),
      ])
      return { columns, tasks } as BoardData
    },
    enabled: !!projectId,
    refetchInterval: 30_000,
  })
}

export function useMoveTask(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      taskId,
      columnId,
      orderIndex,
    }: {
      taskId: string
      columnId: string
      orderIndex: number
    }) =>
      apiClient.patch(`/projects/${projectId}/tasks/${taskId}`, {
        columnId,
        orderIndex,
      }),
    onMutate: async ({ taskId, columnId, orderIndex }) => {
      await queryClient.cancelQueries({ queryKey: ['board', projectId] })
      const prev = queryClient.getQueryData<BoardData>(['board', projectId])
      if (prev) {
        queryClient.setQueryData<BoardData>(['board', projectId], {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === taskId ? { ...t, columnId, orderIndex } : t
          ),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['board', projectId], context.prev)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board', projectId] })
    },
  })
}
