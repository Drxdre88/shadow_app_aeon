'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadKairosThread } from '@/lib/actions/kairos-chat'
import type { ChatMessage } from '@/lib/data/kairos-chat'

// With the chat routine on, a send returns before Kairos has answered: the
// reply is written to the thread by the Max-plan routine (or its backup).
// Poll the thread until an assistant message lands after the operator's
// turn; past `maxMs` stop polling and show the "check back" state.

export const REPLY_POLL_MS = 3_000
export const REPLY_WAIT_MS = 180_000

export type ReplyWatchState = 'thinking' | 'stale'

type LoadedThread = NonNullable<Awaited<ReturnType<typeof loadKairosThread>>>

interface Awaiting {
  threadId: string
  userSeq: number
  startedAt: number
}

export function hasReplyAfter(messages: readonly Pick<ChatMessage, 'role' | 'seq'>[], userSeq: number): boolean {
  return messages.some((m) => m.role === 'assistant' && m.seq > userSeq)
}

export function useKairosReplyWatch(
  onLoaded: (loaded: LoadedThread) => void,
  { pollMs = REPLY_POLL_MS, maxMs = REPLY_WAIT_MS }: { pollMs?: number; maxMs?: number } = {},
) {
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null)
  const [stale, setStale] = useState(false)
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded })

  const start = useCallback((threadId: string, userSeq: number) => {
    setAwaiting({ threadId, userSeq, startedAt: Date.now() })
    setStale(false)
  }, [])

  // Any load of the awaited thread (poll, re-open, refresh) may carry the reply.
  const observe = useCallback((threadId: string, messages: readonly Pick<ChatMessage, 'role' | 'seq'>[]) => {
    setAwaiting((cur) => (cur && cur.threadId === threadId && hasReplyAfter(messages, cur.userSeq) ? null : cur))
  }, [])

  useEffect(() => {
    if (!awaiting || stale) return
    let cancelled = false
    let inFlight = false
    const tick = () => {
      if (Date.now() - awaiting.startedAt >= maxMs) {
        setStale(true)
        return
      }
      if (inFlight) return
      inFlight = true
      loadKairosThread({ threadId: awaiting.threadId })
        .then((loaded) => {
          if (cancelled) return
          if (!loaded) {
            setAwaiting(null)
            return
          }
          onLoadedRef.current(loaded)
          if (hasReplyAfter(loaded.messages, awaiting.userSeq)) setAwaiting(null)
        })
        .catch(() => { /* next tick retries */ })
        .finally(() => { inFlight = false })
    }
    const id = window.setInterval(tick, pollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [awaiting, stale, pollMs, maxMs])

  const stateFor = useCallback((threadId: string | null | undefined): ReplyWatchState | null => {
    if (!awaiting || awaiting.threadId !== threadId) return null
    return stale ? 'stale' : 'thinking'
  }, [awaiting, stale])

  return { start, observe, stateFor }
}
