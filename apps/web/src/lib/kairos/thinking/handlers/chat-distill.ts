import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import {
  CHAT_DISTILL_MAX_TOKENS,
  chatDistillJobKey,
  chatDistillOriginKind,
  chatDistillSkipReason,
  gatherChatDistillThreads,
  persistChatDistillReflections,
  resolveChatDistillDate,
  type ChatDistillPersistInput,
} from '@/lib/kairos/chat-distill'
import {
  CHAT_DISTILL_SYSTEM_PROMPT,
  buildChatDistillUserPrompt,
  parseChatDistillResponse,
  type ChatDistillCandidate,
} from '@/lib/kairos/chat-distill-prompt'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import type {
  ApplyOutcome,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { isOriginKind } from '@/lib/kairos/origin'
import { CHAT_DISTILL_WINDOW_UTC, minutesLeftInWindow } from '../deadlines'
import { errorReason } from './_errors'

// Chat distill on the thinking queue: one job per chat thread with messages
// on yesterday (UTC), with exactly the prompt the 02:00 chat-distill cron
// would send. The answer is parsed strictly and persisted through the cron's
// own persistChatDistillReflections (same externalIds, so the two paths
// dedupe); the cron skips every thread whose job is done.
// Fallback = the 02:00 cron itself; the sweep only marks the job expired.

function readContext(job: ThinkingJobRow): ChatDistillPersistInput | null {
  const c = job.input?.context as Partial<ChatDistillPersistInput> | undefined
  if (!c || typeof c.threadId !== 'string' || typeof c.date !== 'string' || !isOriginKind(c.originKind)) return null
  return {
    threadId: c.threadId,
    dominionId: typeof c.dominionId === 'string' ? c.dominionId : null,
    date: c.date,
    messageSeqs: Array.isArray(c.messageSeqs) ? c.messageSeqs : [],
    ...(typeof c.askId === 'string' ? { askId: c.askId } : {}),
    originKind: c.originKind,
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesLeftInWindow(now, CHAT_DISTILL_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []

  const target = resolveChatDistillDate(undefined, now)
  // Yesterday's transcripts are frozen, so one planning pass covers them all:
  // once any job for the date exists, skip the thread read on later claims.
  if (await hasJobWithKeyLike(userId, 'chat_distill', chatDistillJobKey('%', target.date))) return []
  const { threads, askIdByThreadId } = await gatherChatDistillThreads(userId, target)

  const specs: ThinkingJobSpec[] = []
  for (const thread of threads) {
    if (chatDistillSkipReason(thread)) continue

    const askId = askIdByThreadId.get(thread.id)
    specs.push({
      kind: 'chat_distill',
      dominionId: thread.dominionId,
      externalKey: chatDistillJobKey(thread.id, target.date),
      deadlineMinutes,
      input: {
        system: CHAT_DISTILL_SYSTEM_PROMPT,
        prompt: buildChatDistillUserPrompt(thread, target.date, askId),
        maxOutputTokens: CHAT_DISTILL_MAX_TOKENS,
        context: {
          threadId: thread.id,
          dominionId: thread.dominionId,
          date: target.date,
          messageSeqs: thread.messages.map((m) => m.seq),
          ...(askId ? { askId } : {}),
          originKind: chatDistillOriginKind(thread),
        } satisfies ChatDistillPersistInput,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: chat_distill job has no thread/date/origin context' }
  const expected = resolveChatDistillDate(undefined, new Date()).date
  if (c.date !== expected) return { ok: false, reason: `stale_job: planned for ${c.date}` }

  // Unparseable text throws; a valid answer with zero reflections is a real
  // "no durable signal" result, not a failure.
  let candidates: ChatDistillCandidate[]
  try {
    candidates = parseChatDistillResponse(text.trim())
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  // Stable externalIds: a thread the cron (or a backfill) already distilled
  // dedupes in captureMemory and returns the existing rows.
  const captures = await persistChatDistillReflections(job.userId, c, candidates)
  await writeCronSuccessTrace(job.userId, { cronName: 'chat-distill' })
  return { ok: true, memoryIds: captures.map((capture) => capture.memory.id) }
}

export const chatDistillHandler: ThinkingJobHandler = {
  kind: 'chat_distill',
  plan,
  apply,
  // The 02:00 chat-distill cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 02:00 UTC chat-distill cron' }),
}
