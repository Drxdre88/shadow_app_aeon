import { sql } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { META_STREAM_CLASSES } from '@/lib/kairos/streamClass'
import { detectSensitiveTopics } from './lexicon'
import { getSensitiveGate } from './pref'
import type { SensitiveStamp } from './meta'

// Rows held for the owner's review stay out of every reader that applies
// validAsOfNow (retrieval, prompts, belief inputs, the engine). Literal SQL
// (no bound params) so it never shifts the param list of the queries it joins.
export const notHeldSensitive = sql`(${memories.sourceMetadata}->>'sensitiveHeld') IS DISTINCT FROM 'true'`

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
