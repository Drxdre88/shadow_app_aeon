// Posts events and status updates back to the Aeon /api/v1/sessions surface.
// The session row already exists when the worker receives /spawn — its job
// is to flip the row through queued → running → succeeded/failed and to drop
// events on the timeline as the CLI emits them.

export interface CallbackContext {
  sessionId: string
  callbackBaseUrl: string
  callbackToken: string
}

export async function postEvent(
  ctx: CallbackContext,
  body: { seq?: number; kind: string; toolName?: string | null; payload?: unknown },
): Promise<void> {
  try {
    await fetch(`${ctx.callbackBaseUrl.replace(/\/$/, '')}/api/v1/sessions/${ctx.sessionId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.callbackToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.error('[worker/callback] postEvent failed', err)
  }
}

export async function patchSession(
  ctx: CallbackContext,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${ctx.callbackBaseUrl.replace(/\/$/, '')}/api/v1/sessions/${ctx.sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.callbackToken}`,
      },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.error('[worker/callback] patchSession failed', err)
  }
}
