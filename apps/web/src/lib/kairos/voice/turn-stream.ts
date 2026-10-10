import { SpeechChunker } from './speech-chunker'

// Server-sent events for one voice turn: `delta` (whole spoken sentences, in
// order), then exactly one terminal event, `done` or `error`. Pure framing
// over a caller-supplied turn runner, so it is testable without the engine.

export type VoiceTurnEvent = 'delta' | 'done' | 'error'

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
}

export function sseFrame(event: VoiceTurnEvent, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export interface VoiceTurnDone {
  threadId: string
  userSeq: number
  assistantSeq: number
  // The persisted reply as plain speech. Speak it when no delta arrived.
  text: string
  model: string | null
}

export type VoiceTurnOutcome =
  | { ok: true; done: VoiceTurnDone }
  | { ok: false; reason: string; message?: string; threadId?: string }

export interface VoiceTurnTiming {
  firstDeltaMs: number | null
  totalMs: number
  deltas: number
  ok: boolean
}

// Words only: sentence-by-sentence cleaning and whole-reply cleaning can differ
// in punctuation and spacing without the listener hearing anything different.
export function speechKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

// `run` receives the raw-text sink and resolves when the turn is persisted.
export function createVoiceTurnStream(
  run: (onText: (text: string) => void) => Promise<VoiceTurnOutcome>,
  onSettled?: (timing: VoiceTurnTiming) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const startedAt = Date.now()
  let open = true
  let deltas = 0
  let firstDeltaMs: number | null = null

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: VoiceTurnEvent, data: unknown) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)))
        } catch {
          open = false
        }
      }
      const spoken: string[] = []
      const chunker = new SpeechChunker((text) => {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt
        deltas += 1
        spoken.push(text)
        send('delta', { text })
      })
      let ok = false
      try {
        let settled = false
        const outcome = await run((text) => { if (!settled) chunker.push(text) })
        settled = true
        chunker.flush()
        if (outcome.ok) {
          ok = true
          // done.text is always the saved reply; replaced tells the client the
          // deltas it spoke differ from it (a deadline fallback, a trimmed or
          // rewritten reply), so it should re-speak done.text.
          const replaced = deltas > 0 && speechKey(spoken.join(' ')) !== speechKey(outcome.done.text)
          send('done', { ...outcome.done, streamed: deltas > 0, replaced, ms: Date.now() - startedAt })
        } else {
          send('error', { reason: outcome.reason, message: outcome.message ?? null, threadId: outcome.threadId ?? null })
        }
      } catch (err) {
        send('error', { reason: 'ai_failed', message: err instanceof Error ? err.message : String(err), threadId: null })
      } finally {
        onSettled?.({ firstDeltaMs, totalMs: Date.now() - startedAt, deltas, ok })
        if (open) {
          open = false
          controller.close()
        }
      }
    },
    cancel() {
      open = false
    },
  })
}
