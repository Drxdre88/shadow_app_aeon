// Kairos Phase 3 (D14/D16) — worker-host dispatch helper.
//
// The server action creates the agent_sessions row and then calls
// `dispatchSpawn()` to hand the actual CLI invocation to the worker host
// (apps/kairos-worker/). When KAIROS_WORKER_URL is unset (dev without a
// worker running yet) the call is a logged no-op so the rest of the
// primitive can be exercised end-to-end without the worker present.

import type { AgentSession } from '@/lib/db/schema'

export interface SpawnDispatchPayload {
  sessionId: string
  engine: AgentSession['engine']
  repo: string | null
  branch: string | null
  goal: string
  prompt: string
  // Bearer token the worker uses to POST events / status updates back.
  callbackToken: string
  callbackBaseUrl: string
}

export interface SpawnDispatchResult {
  dispatched: boolean
  workerHost: string | null
  reason?: string
}

export async function dispatchSpawn(payload: SpawnDispatchPayload): Promise<SpawnDispatchResult> {
  const workerUrl = process.env.KAIROS_WORKER_URL
  const workerSecret = process.env.KAIROS_WORKER_SECRET

  if (!workerUrl) {
    console.warn('[kairos/spawn] KAIROS_WORKER_URL unset — session created but not dispatched', {
      sessionId: payload.sessionId,
    })
    return { dispatched: false, workerHost: null, reason: 'worker_url_unset' }
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/spawn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
      },
      body: JSON.stringify(payload),
      // Worker may take a moment to start the CLI — short timeout, fire-async
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        dispatched: false,
        workerHost: null,
        reason: `worker_${res.status}:${text.slice(0, 200)}`,
      }
    }

    const body = (await res.json().catch(() => ({}))) as { workerHost?: string }
    return { dispatched: true, workerHost: body.workerHost ?? null }
  } catch (err) {
    console.error('[kairos/spawn] dispatch failed', err)
    return {
      dispatched: false,
      workerHost: null,
      reason: err instanceof Error ? err.message : 'dispatch_error',
    }
  }
}
