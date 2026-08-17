'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useBoardStore, registerPendingWritesSource } from './boardStore'
import { withRetry, isTransientError } from './persistMutation'
import { toast } from '@/components/ui/Toast'
import { dispatchMutation, isAlreadyApplied, type QueuedMutation } from './mutationDispatch'

export type MutationSideEffects = {
  rollback?: () => void
  onSuccess?: (result: unknown) => void
  failMessage?: string
}

interface QueueState {
  pending: QueuedMutation[]
  flushing: boolean
  enqueue: (mutation: QueuedMutation, fx?: MutationSideEffects) => void
  flush: () => Promise<void>
}

// Rollback / onSuccess are closures — not serialisable — so they live in memory
// keyed by mutation id, beside the persisted record. After a reload they're
// absent: the record still replays (idempotent), and any hard reject self-heals
// on the next server version-check, so correctness never depends on them.
const sideEffects = new Map<string, MutationSideEffects>()

let retryTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void useMutationQueue.getState().flush()
  }, 8000)
}

export const useMutationQueue = create<QueueState>()(
  persist(
    (set, get) => ({
      pending: [],
      flushing: false,

      enqueue: (mutation, fx) => {
        if (fx) sideEffects.set(mutation.id, fx)
        if (pendingSince === null) pendingSince = Date.now()
        set((s) => ({ pending: [...s.pending, mutation] }))
        void get().flush()
      },

      flush: async () => {
        if (get().flushing || get().pending.length === 0) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          useBoardStore.getState().setSaveStatus('offline')
          scheduleRetry()
          return
        }

        set({ flushing: true })
        useBoardStore.getState().setSaveStatus('saving')
        try {
          // FIFO: preserve causal order (a card must be created before it moves).
          while (get().pending.length > 0) {
            const mutation = get().pending[0]
            const fx = sideEffects.get(mutation.id)
            try {
              const result = await withRetry(
                () => dispatchMutation(mutation),
                () => useBoardStore.getState().setSaveStatus('retrying'),
              )
              sideEffects.delete(mutation.id)
              set((s) => ({ pending: s.pending.filter((p) => p.id !== mutation.id) }))
              fx?.onSuccess?.(result)
            } catch (err) {
              if (isAlreadyApplied(err)) {
                // Already on the server from a prior attempt — treat as success.
                sideEffects.delete(mutation.id)
                set((s) => ({ pending: s.pending.filter((p) => p.id !== mutation.id) }))
                fx?.onSuccess?.(undefined)
                continue
              }
              if (isTransientError(err)) {
                // Server still unreachable after inline retries. Keep the record
                // queued and wait for reconnect — nothing is lost, the optimistic
                // edit stays applied locally.
                useBoardStore.getState().setSaveStatus('offline')
                set({ flushing: false })
                scheduleRetry()
                return
              }
              // Hard rejection (permission / validation): drop, roll back, notify.
              console.error('[mutationQueue] dropping rejected mutation', mutation.type, err)
              sideEffects.delete(mutation.id)
              set((s) => ({ pending: s.pending.filter((p) => p.id !== mutation.id) }))
              fx?.rollback?.()
              const viewOnly = err instanceof Error && err.message.includes('Viewers cannot modify')
              toast(
                viewOnly
                  ? 'You have view-only access to this project'
                  : (fx?.failMessage ?? 'Could not save — changes reverted'),
                { force: true },
              )
            }
          }
          pendingSince = null
          useBoardStore.setState({ isDirty: false })
          useBoardStore.getState().setSaveStatus('saved')
        } finally {
          set({ flushing: false })
        }
      },
    }),
    {
      name: 'aeon-mutation-queue',
      // Only the records are durable; the closures intentionally are not.
      partialize: (s) => ({ pending: s.pending }),
    },
  ),
)

// While anything is queued or mid-flush, board reloads (poll / Pusher echo)
// must not wholesale-replace the store — the read could predate the write.
// Registered here (not computed in boardStore) to avoid a circular import.
//
// Bounded: the pending records persist to localStorage and a record that keeps
// failing transiently retries every 8s forever, so an unbounded source would
// suppress reloads for this browser profile indefinitely (across sessions).
// After the cap, reloads resume — queued optimistic edits may briefly leave
// view, but the records stay queued and re-apply when the flush finally lands.
const MAX_RELOAD_SUPPRESS_MS = 5 * 60_000
let pendingSince: number | null = null
registerPendingWritesSource(() => {
  const s = useMutationQueue.getState()
  if (s.flushing) return true
  if (s.pending.length === 0) return false
  // Records restored from localStorage on load never went through enqueue.
  if (pendingSince === null) pendingSince = Date.now()
  return Date.now() - pendingSince < MAX_RELOAD_SUPPRESS_MS
})

// Re-flush the moment we can reach the server again: on reconnect, on tab
// focus, and once on load — so edits made offline (or queued when a tab was
// closed mid-save) sync without the user lifting a finger.
if (typeof window !== 'undefined') {
  const kick = () => void useMutationQueue.getState().flush()
  window.addEventListener('online', kick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick()
  })
  setTimeout(kick, 0)
}
