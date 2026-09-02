'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBoardStore, beginDirectWrite, endDirectWrite, type BoardTask } from '@/lib/store/boardStore'
import { fuseBoardTasks, unfuseBoardTasks } from '@/lib/actions/fuse'
import { toast } from '@/components/ui/Toast'
import { applyFuseOptimistic, applyFuseResult, captureFuseSlice, restoreFuseSlice } from './fuseClient'

export interface FuseRequest {
  sourceId: string
  targetId: string
  /** The two cards as they were when the drop asked — the modal shows these, so a board filter cannot unmount it. */
  source: BoardTask
  target: BoardTask
}

/**
 * Board-level lifecycle of a card fusion: the drop raises a request, the
 * modal confirms it with a title, the store merges optimistically while the
 * server action lands, and the toast's Undo (also Ctrl+Z, via the undo
 * store the toast registers in) reverses both.
 */
export function useFuseCards(projectId: string) {
  const [request, setRequest] = useState<FuseRequest | null>(null)
  const [isFusing, setIsFusing] = useState(false)

  const requestFuse = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const tasks = useBoardStore.getState().tasks
    const source = tasks.find((t) => t.id === sourceId)
    const target = tasks.find((t) => t.id === targetId)
    if (!source || !target) return
    setRequest({ sourceId, targetId, source, target })
  }, [])

  // Either card leaving the store while the modal is up (deleted or archived
  // by a peer) ends the request; while a fusion is in flight the source is
  // gone on purpose, so the check waits.
  const pairAlive = useBoardStore((s) =>
    !request || (s.tasks.some((t) => t.id === request.sourceId) && s.tasks.some((t) => t.id === request.targetId)),
  )
  useEffect(() => {
    if (request && !isFusing && !pairAlive) setRequest(null)
  }, [request, isFusing, pairAlive])

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
            .catch((err) => {
              // The server still holds the fused card: put the board back to
              // that, and let realtime reloads through again.
              applyFuseOptimistic(slice, result.survivor.name)
              applyFuseResult(result.survivor, result.labelIds)
              useBoardStore.setState({ isDirty: false })
              toast(err instanceof Error ? err.message : 'Could not undo the fusion', { force: true })
            })
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
