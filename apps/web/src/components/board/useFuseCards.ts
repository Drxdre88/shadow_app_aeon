'use client'

import { useCallback, useMemo, useState } from 'react'
import { useBoardStore, beginDirectWrite, endDirectWrite } from '@/lib/store/boardStore'
import { fuseBoardTasks, unfuseBoardTasks } from '@/lib/actions/fuse'
import { toast } from '@/components/ui/Toast'
import { applyFuseOptimistic, applyFuseResult, captureFuseSlice, restoreFuseSlice } from './fuseClient'

export interface FuseRequest {
  sourceId: string
  targetId: string
}

/**
 * Board-level lifecycle of a card fusion: the drop raises a request, the
 * modal confirms it with a title, the store merges optimistically while the
 * server action lands, and the toast's Undo reverses both.
 */
export function useFuseCards(projectId: string) {
  const [request, setRequest] = useState<FuseRequest | null>(null)
  const [isFusing, setIsFusing] = useState(false)

  const requestFuse = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setRequest({ sourceId, targetId })
  }, [])

  const cancelFuse = useCallback(() => {
    if (!isFusing) setRequest(null)
  }, [isFusing])

  const confirmFuse = useCallback(async (name: string) => {
    if (!request || isFusing) return
    const slice = captureFuseSlice(useBoardStore.getState(), request.sourceId, request.targetId)
    if (!slice) {
      setRequest(null)
      toast('One of the cards is no longer on the board', { force: true })
      return
    }

    setIsFusing(true)
    beginDirectWrite()
    applyFuseOptimistic(slice, name)
    try {
      const result = await fuseBoardTasks({ projectId, survivorId: request.targetId, sourceId: request.sourceId, name })
      applyFuseResult(result.survivor, result.labelIds)
      useBoardStore.setState({ isDirty: false })
      setRequest(null)
      toast(`Fused "${slice.sourceTask.name}" into "${result.survivor.name}"`, {
        onUndo: () => {
          restoreFuseSlice(slice)
          beginDirectWrite()
          unfuseBoardTasks(projectId, result.snapshot)
            .then(() => { useBoardStore.setState({ isDirty: false }) })
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not undo the fusion', { force: true }))
            .finally(endDirectWrite)
        },
      })
    } catch (err) {
      restoreFuseSlice(slice)
      useBoardStore.setState({ isDirty: false })
      toast(err instanceof Error ? err.message : 'Could not fuse the cards — reverted', { force: true })
    } finally {
      endDirectWrite()
      setIsFusing(false)
    }
  }, [request, isFusing, projectId])

  return useMemo(() => ({ request, isFusing, requestFuse, cancelFuse, confirmFuse }), [request, isFusing, requestFuse, cancelFuse, confirmFuse])
}
