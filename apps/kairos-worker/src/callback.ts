// Posts events and status updates back to the Aeon /api/v1/sessions surface.
// The session row already exists when the worker receives /spawn — its job
// is to flip the row through queued → running → succeeded/failed and to drop
// events on the timeline as the CLI emits them.
//
// Push mode authenticates with the per-spawn callbackToken Aeon hands over.
// Poll mode (AI Hangar) talks to the same routes with the operator's
// AEON_API_KEY, so both paths share the transport below.

const TIMEOUT_MS = 10_000

// Aeon rate-limits writes to 60/min. A chatty stream can spend that budget
// right before the terminal post, so terminal calls retry across a full window.
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]

export const AEON_BASE_URL = (process.env.AEON_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

// KAIROS_AEON_API_KEY is the per-user runner key. Plain AEON_API_KEY is the
// name Aeon's *server* gives its master key (admin scope + rate-limit bypass),
// so a shared .env would silently hand the runner admin rights.
export const AEON_API_KEY = process.env.KAIROS_AEON_API_KEY ?? process.env.AEON_API_KEY ?? ''

if (!process.env.KAIROS_AEON_API_KEY && process.env.AEON_API_KEY) {
  console.warn(
    '[worker/callback] falling back to AEON_API_KEY — that name is Aeon\'s server master key ' +
    '(admin + rate-limit bypass). Set KAIROS_AEON_API_KEY to a per-user runner key instead.'
  )
}

export interface CallbackContext {
  sessionId: string
  callbackBaseUrl: string
  callbackToken: string
}

export interface AeonResponse<T = unknown> {
  ok: boolean
  status: number
  data: T | null
}

// Every Aeon REST response is wrapped in { data } (or { error }) — unwrap it
// here so callers deal in payloads. Network failures surface as status 0
// rather than throwing: the worker must never die because Aeon blipped.
export async function aeonFetch<T = unknown>(
  baseUrl: string,
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<AeonResponse<T>> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const envelope = payload as { data?: T } | null
    return { ok: res.ok, status: res.status, data: (envelope?.data ?? null) as T | null }
  } catch (err) {
    console.error(`[worker/callback] ${init?.method ?? 'GET'} ${path} failed`, err)
    return { ok: false, status: 0, data: null }
  }
}

export function pollContext(sessionId: string): CallbackContext {
  return { sessionId, callbackBaseUrl: AEON_BASE_URL, callbackToken: AEON_API_KEY }
}

// Generic so the terminal result post can read Aeon's acknowledgement shape;
// every other call site keeps the default `unknown` payload.
export async function postEvent<T = unknown>(
  ctx: CallbackContext,
  body: { seq?: number; kind: string; toolName?: string | null; payload?: unknown },
): Promise<AeonResponse<T>> {
  return aeonFetch<T>(ctx.callbackBaseUrl, ctx.callbackToken, `/api/v1/sessions/${ctx.sessionId}/events`, {
    method: 'POST',
    body,
  })
}

export interface BatchEvent {
  seq: number
  kind: string
  toolName?: string | null
  payload?: unknown
}

// The server accepts at most 100 events per batch; staying well under keeps
// the two sides from ever disagreeing after a limit change on either end.
const BATCH_CHUNK = 40

interface BatchAck {
  accepted?: number
  received?: number
  rejected?: number
}

// Typed telemetry flush: many events, few writes against the 60/min budget.
// Oversized flushes are chunked and sent sequentially (preserves seq order);
// each chunk gets one bounded retry — a lost mid-stream chunk degrades the
// timeline, it does not corrupt it (seq gaps are tolerated by the reader), so
// we never block subsequent flushes behind a struggling one.
export async function postEventsBatch(
  ctx: CallbackContext,
  events: BatchEvent[],
): Promise<void> {
  for (let i = 0; i < events.length; i += BATCH_CHUNK) {
    const chunk = events.slice(i, i + BATCH_CHUNK)
    const attempt = (): Promise<AeonResponse<BatchAck>> =>
      aeonFetch<BatchAck>(ctx.callbackBaseUrl, ctx.callbackToken, `/api/v1/sessions/${ctx.sessionId}/events`, {
        method: 'POST',
        body: { events: chunk },
      })
    let res = await attempt()
    if (!res.ok && retriable(res.status)) {
      await sleep(3_000)
      res = await attempt()
    }
    if (!res.ok) {
      console.warn(`[worker/callback] event batch dropped (${res.status}, ${chunk.length} events)`)
      continue
    }
    // Fewer rows than sent means schema rejects or seq collisions (a hook post
    // can consume a slot the runner's counter reuses) — surface it, silence
    // here is undiagnosable missing timeline rows.
    const accepted = res.data?.accepted
    if (typeof accepted === 'number' && accepted < chunk.length) {
      console.warn(
        `[worker/callback] event batch partially landed (${accepted}/${chunk.length}` +
        `${res.data?.rejected ? `, ${res.data.rejected} rejected` : ''})`
      )
    }
  }
}

export async function patchSession(
  ctx: CallbackContext,
  patch: Record<string, unknown>,
): Promise<AeonResponse> {
  return aeonFetch(ctx.callbackBaseUrl, ctx.callbackToken, `/api/v1/sessions/${ctx.sessionId}`, {
    method: 'PATCH',
    body: patch,
  })
}

// Rate limiting, a cold start and a network blip are all worth another go; a
// 4xx that means "this payload is wrong" is not.
function retriable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

// Wraps the terminal result event / final status PATCH so a rate-limited write
// can't leave a finished session stuck on 'running'.
export async function withRetry<T = unknown>(
  label: string,
  attempt: () => Promise<AeonResponse<T>>,
): Promise<AeonResponse<T>> {
  let res = await attempt()
  for (const delay of RETRY_DELAYS_MS) {
    if (res.ok || !retriable(res.status)) break
    console.warn(`[worker/callback] ${label} failed (${res.status}) — retrying in ${delay}ms`)
    await sleep(delay)
    res = await attempt()
  }
  if (!res.ok) console.error(`[worker/callback] ${label} gave up (${res.status})`)
  return res
}
