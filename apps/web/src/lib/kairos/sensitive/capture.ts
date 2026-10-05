import { getSensitiveGate } from '@/lib/data/kairos-sensitive'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import { detectSensitiveTopics } from './lexicon'
import type { SensitiveStamp } from './meta'

// Held rows stay out of readers that apply validAsOfNow (retrieval, chat
// context, prepareContext) and of the prompt/message readers that add
// notHeldSensitive (./held) themselves. Pure scoring readers (memory engine,
// belief signal inputs) do not filter: a held row can still move a score,
// but its text never reaches a prompt or a message.

interface CaptureText {
  title?: string | null
  summary?: string | null
  bodyMd?: string | null
}

const META = new Set<string>(META_STREAM_CLASSES)

// The capture hook: {} unless the gate is on and the new row touches a
// sensitive topic. Bookkeeping streams are never held. Never throws — a
// failed preference read captures the row normally.
export async function sensitiveCaptureStamp(
  userId: string,
  input: CaptureText,
  streamClass?: string | null,
): Promise<SensitiveStamp | Record<string, never>> {
  if (streamClass && META.has(streamClass)) return {}
  const topics = detectSensitiveTopics([input.title, input.summary, input.bodyMd].filter(Boolean).join('\n'))
  if (topics.length === 0) return {}
  try {
    if (!(await getSensitiveGate(userId))) return {}
  } catch (err) {
    console.warn('[vorath] sensitive gate read failed; capturing without hold', err)
    return {}
  }
  return { sensitive: true, sensitiveHeld: true, sensitiveTopics: topics }
}
