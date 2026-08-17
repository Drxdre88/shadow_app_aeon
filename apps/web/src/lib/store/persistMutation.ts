'use client'

import { useBoardStore, beginDirectWrite, endDirectWrite } from './boardStore'
import { toast } from '@/components/ui/Toast'

// A failure worth retrying: a Neon cold-start resume, a dropped serverless
// socket, or a transient gateway blip — NOT a real rejection like a permission
// error or a validation failure (those should fail fast and roll back).
const TRANSIENT =
  /fetch failed|failed to fetch|network|timeout|timed out|ECONNRESET|ETIMEDOUT|EPIPE|socket|terminat|connection|502|503|504|gateway/i

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (/Viewers cannot modify|view-only|unauthorized|not a member|invalid/i.test(err.message)) return false
  return TRANSIENT.test(err.message)
}

// Backoff ladder sized to outlast a Neon scale-to-zero resume (≈0.5–3s):
// four total attempts over ~3.6s before we give up and roll back.
const BACKOFFS_MS = [400, 1000, 2200]

export async function withRetry<T>(run: () => Promise<T>, onRetry?: () => void): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= BACKOFFS_MS.length; attempt++) {
    try {
      return await run()
    } catch (err) {
      lastErr = err
      if (attempt === BACKOFFS_MS.length || !isTransientError(err)) throw err
      onRetry?.()
      await new Promise((resolve) => setTimeout(resolve, BACKOFFS_MS[attempt]))
    }
  }
  throw lastErr
}

// The single durable save path for board mutations. Applies the optimistic
// store change FIRST (caller's responsibility), then persists with retry while
// surfacing a live save status. On terminal failure it rolls back and tells the
// user — their edit is never silently lost to a sleeping database.
export async function persistMutation<T>(
  run: () => Promise<T>,
  opts: { rollback?: () => void; failMessage?: string; onSuccess?: (result: T) => void } = {},
): Promise<void> {
  useBoardStore.getState().setSaveStatus('saving')
  beginDirectWrite()
  try {
    const result = await withRetry(run, () => useBoardStore.getState().setSaveStatus('retrying'))
    useBoardStore.setState({ isDirty: false })
    useBoardStore.getState().setSaveStatus('saved')
    opts.onSuccess?.(result)
  } catch (err) {
    console.error('[persistMutation] save failed after retries:', err)
    opts.rollback?.()
    useBoardStore.setState({ isDirty: false })
    useBoardStore.getState().setSaveStatus('error')
    const viewOnly = err instanceof Error && err.message.includes('Viewers cannot modify')
    toast(
      viewOnly ? 'You have view-only access to this project' : (opts.failMessage ?? 'Could not save — changes reverted'),
      { force: true },
    )
  } finally {
    endDirectWrite()
  }
}
