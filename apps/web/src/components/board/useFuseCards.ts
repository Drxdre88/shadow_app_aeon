'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBoardStore, beginDirectWrite, endDirectWrite, type BoardTask } from '@/lib/store/boardStore'
import { fuseBoardTasks, unfuseBoardTasks } from '@/lib/actions/fuse'
import type { FuseResult } from '@/lib/data/fuse'
import { toast } from '@/components/ui/Toast'
import { applyFuseOptimistic, applyFuseResult, captureFuseSlice, restoreFuseSlice, type FuseStoreSlice } from './fuseClient'
import type { RequestFuse } from './fuseRequestContext'

export interface FuseRequest {
  /** The card the others fuse INTO — survives, renamed. */
  targetId: string
  /** Absorbed and removed, in selection order. */
  sourceIds: string[]
  /** The cards as they were when the menu asked — the modal shows these, so a board filter cannot unmount it. */
  target: BoardTask
  sources: BoardTask[]
}

interface FuseStep {
  slice: FuseStoreSlice
  result: FuseResult
}

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * Board-level lifecycle of a card fusion: the card menu raises a request
 * (select cards, right-click one → "Fuse N cards into this one"), the modal
 * confirms it with a title, and the sources are absorbed one at a time — the
 * store merges optimistically while each server action lands. The toast's
 * Undo (also Ctrl+Z, via the undo store the toast registers in) reverses
 * every step. The menu reaches requestFuse through FuseRequestContext.
 */
export function useFuseCards(projectId: string) {
  const [request, setRequest] = useState<FuseRequest | null>(null)
  const [isFusing, setIsFusing] = useState(false)

  const requestFuse = useCallback<RequestFuse>((targetId, sourceIds) => {
    const tasks = useBoardStore.getState().tasks
    const target = tasks.find((t) => t.id === targetId)
    if (!target) return
    const sources: BoardTask[] = []
    for (const id of sourceIds) {
      if (id === targetId || sources.some((s) => s.id === id)) continue
      const source = tasks.find((t) => t.id === id)
      if (source && source.projectId === target.projectId) sources.push(source)
    }
    if (sources.length === 0) return
    setRequest({ targetId, sourceIds: sources.map((s) => s.id), target, sources })
  }, [])

  // Any card leaving the store while the modal is up (deleted or archived by
  // a peer) ends the request; while a fusion is in flight the sources are
  // gone on purpose, so the check waits. Subscribed to the tasks array only
  // while a request is open, and scanned once per change of it — not on
  // every store update.
  const tasks = useBoardStore((s) => (request ? s.tasks : null))
  const allAlive = useMemo(() => {
    if (!request || !tasks) return true
    const wanted = new Set([request.targetId, ...request.sourceIds])
    let found = 0
    for (const t of tasks) {
      if (wanted.has(t.id) && ++found === wanted.size) return true
    }
    return false
  }, [request, tasks])
  useEffect(() => {
    if (request && !isFusing && !allAlive) setRequest(null)
  }, [request, isFusing, allAlive])

  const cancelFuse = useCallback(() => {
    if (!isFusing) setRequest(null)
  }, [isFusing])

  // Undo runs backwards: the last fusion is undone first, so every unfuse
  // finds the survivor exactly as it was right after the one before it. A
  // failed unfuse leaves the server holding the earlier fusions, so the
  // store is put back to that — never to a phantom un-fused card.
  const undoSteps = useCallback((steps: FuseStep[]) => {
    const reversed = [...steps].reverse()
    for (const step of reversed) restoreFuseSlice(step.slice)
    beginDirectWrite()
    ;(async () => {
      let undone = 0
      try {
        for (const step of reversed) {
          await unfuseBoardTasks(projectId, step.result.snapshot)
          undone++
        }
        useBoardStore.setState({ isDirty: false })
      } catch (err) {
        for (const step of steps.slice(0, steps.length - undone)) {
          applyFuseOptimistic(step.slice, step.result.survivor.name)
          applyFuseResult(step.result.survivor, step.result.labelIds)
        }
        useBoardStore.setState({ isDirty: false })
        toast(errorMessage(err, 'Could not undo the fusion'), { force: true })
      } finally {
        endDirectWrite()
      }
    })()
  }, [projectId])

  const confirmFuse = useCallback(async (name: string) => {
    if (!request || isFusing) return
    const total = request.sourceIds.length
    const steps: FuseStep[] = []
    let failure: unknown = null
    let vanished = false

    setIsFusing(true)
    beginDirectWrite()
    try {
      for (const sourceId of request.sourceIds) {
        const slice = captureFuseSlice(useBoardStore.getState(), sourceId, request.targetId)
        if (!slice) { vanished = true; break }
        applyFuseOptimistic(slice, name)
        try {
          const result = await fuseBoardTasks({ projectId, survivorId: request.targetId, sourceId, name })
          applyFuseResult(result.survivor, result.labelIds)
          steps.push({ slice, result })
        } catch (err) {
          restoreFuseSlice(slice)
          failure = err
          break
        }
      }
    } finally {
      useBoardStore.setState({ isDirty: false })
      endDirectWrite()
      setIsFusing(false)
    }

    if (steps.length === 0) {
      if (vanished) {
        setRequest(null)
        toast('One of the cards is no longer on the board', { force: true })
      } else {
        toast(errorMessage(failure, 'Could not fuse the cards — reverted'), { force: true })
      }
      return
    }

    setRequest(null)
    const store = useBoardStore.getState()
    store.clearTaskSelection()
    if (store.selectedTaskId && request.sourceIds.includes(store.selectedTaskId)) store.selectTask(null)

    const survivorName = steps[steps.length - 1].result.survivor.name
    const onUndo = () => undoSteps(steps)
    if (failure || vanished) {
      const why = vanished ? 'a card was no longer on the board' : errorMessage(failure, 'the rest failed')
      toast(`Fused ${steps.length} of ${total} cards into "${survivorName}" — ${why}`, { force: true, onUndo })
    } else if (steps.length === 1) {
      toast(`Fused "${steps[0].slice.sourceTask.name}" into "${survivorName}"`, { onUndo })
    } else {
      toast(`Fused ${steps.length + 1} cards into "${survivorName}"`, { onUndo })
    }
  }, [request, isFusing, projectId, undoSteps])

  return useMemo(() => ({ request, isFusing, requestFuse, cancelFuse, confirmFuse }), [request, isFusing, requestFuse, cancelFuse, confirmFuse])
}
