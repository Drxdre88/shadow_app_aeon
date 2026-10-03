import { listKairosAsksAnsweredBetween } from '@/lib/data/ask'
import { listChatThreadsWithMessagesOn, type DailyChatThread } from '@/lib/data/kairos-chat'
import { DIALOGUE_ENGINE, listDialogueThreadsWithTurnsOn } from '@/lib/data/kairos-dialogue-distill'
import { captureMemory } from '@/lib/data/memories'
import { isJobDone } from '@/lib/data/thinking-jobs'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import {
  CHAT_DISTILL_SYSTEM_PROMPT,
  buildChatDistillUserPrompt,
  parseChatDistillResponse,
  type ChatDistillCandidate,
} from './chat-distill-prompt'
import { writeCronFailureTrace, writeCronSuccessTrace } from './cron-trace'
import { derivedOriginKind, type OriginKind } from './origin'

const DAY_MS = 86_400_000
const MAX_MESSAGES_PER_THREAD = 80
// Must comfortably fit 5 max-length reflections (~2500+ tokens of JSON) —
// the cap genuinely binds since the maxOutputTokens fix, and a truncated
// reply fails the whole thread's parse instead of degrading.
export const CHAT_DISTILL_MAX_TOKENS = 4000

export interface ChatDistillOptions {
  date?: string
  dryRun?: boolean
}

export interface ChatDistillThreadResult {
  threadId: string
  title: string
  status: 'created' | 'existing' | 'skipped' | 'dry_run' | 'error'
  messageSeqs: number[]
  reflectionIds?: string[]
  reflectionsCreated?: number
  reason?: string
  modelInput?: {
    system: string
    prompt: string
    cacheSystem: boolean
    maxTokens: number
  }
}

export interface ChatDistillRunResult {
  date: string
  dryRun: boolean
  reflectionsCreated: number
  threads: ChatDistillThreadResult[]
}

// Thinking-queue key for one thread's distill of one UTC date — the
// chat_distill handler plans it, and the cron skips threads it marks done.
export const chatDistillJobKey = (threadId: string, date: string) => `chat_distill:${threadId}:${date}`

export function resolveChatDistillDate(date?: string, now: Date = new Date()): { date: string; start: Date; end: Date } {
  const target = date ?? new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('date must be YYYY-MM-DD')
  const start = new Date(`${target}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== target) {
    throw new Error('date must be a valid UTC calendar date')
  }
  return { date: target, start, end: new Date(start.getTime() + DAY_MS) }
}

// Threads with messages on the target date, each paired with the ask its
// nearest operator turn resolved that day (if any). With
// KAIROS_DISTILL_DIALOGUES=1, Triad dialogue threads join them (default off:
// commit_dialogue already distills a dialogue the operator closes).
export function distillDialoguesEnabled(): boolean {
  return process.env.KAIROS_DISTILL_DIALOGUES === '1'
}

export async function gatherChatDistillThreads(
  userId: string,
  target: { start: Date; end: Date },
): Promise<{ threads: DailyChatThread[]; askIdByThreadId: Map<string, string> }> {
  const [chatThreads, answeredAsks, dialogueThreads] = await Promise.all([
    listChatThreadsWithMessagesOn(userId, target.start, target.end, MAX_MESSAGES_PER_THREAD),
    listKairosAsksAnsweredBetween(userId, target.start, target.end),
    distillDialoguesEnabled()
      ? listDialogueThreadsWithTurnsOn(userId, target.start, target.end, MAX_MESSAGES_PER_THREAD)
      : Promise.resolve([]),
  ])
  const threads: DailyChatThread[] = [...chatThreads, ...dialogueThreads]
  const askIdByThreadId = new Map<string, string>()
  for (const ask of answeredAsks) {
    let match: { threadId: string; createdAt: number } | null = null
    for (const thread of threads) {
      for (const message of thread.messages) {
        if (message.role !== 'user') continue
        const createdAt = message.createdAt.getTime()
        if (createdAt > ask.answeredAt.getTime() || createdAt <= (match?.createdAt ?? -Infinity)) continue
        match = { threadId: thread.id, createdAt }
      }
    }
    if (match) askIdByThreadId.set(match.threadId, ask.id)
  }
  return { threads, askIdByThreadId }
}

export function chatDistillSkipReason(thread: DailyChatThread): string | null {
  if (thread.messages.length === 0) return 'no messages'
  if (!thread.messages.some((message) => message.role === 'user' && message.content.trim())) return 'no operator messages'
  return null
}

// P2.5: these are Kairos's distillation of the chat, not the operator's
// words — derived origin over the thread's turns (operator's own turns
// and Kairos's replies), which is never better than 'kairos'. A dialogue's
// "operator" turns are relayed by an agent, so they count as agent input.
export function chatDistillOriginKind(thread: DailyChatThread): OriginKind {
  const userKind: OriginKind = (thread as { engine?: string }).engine === DIALOGUE_ENGINE ? 'agent' : 'operator'
  return derivedOriginKind(thread.messages.map((m): OriginKind => (m.role === 'user' ? userKind : 'kairos')))
}

export interface ChatDistillPersistInput {
  threadId: string
  dominionId: string | null
  date: string
  messageSeqs: number[]
  askId?: string
  originKind: OriginKind
}

// The one write path for distilled reflections (cron and thinking queue).
export async function persistChatDistillReflections(
  userId: string,
  input: ChatDistillPersistInput,
  candidates: ChatDistillCandidate[],
) {
  const origin = { kind: input.originKind, via: 'cron:chat-distill' }
  const captures = []
  for (const [index, candidate] of candidates.entries()) {
    captures.push(await captureMemory(userId, {
      type: 'reflection',
      streamClass: 'reflection',
      source: 'cron',
      title: candidate.title,
      bodyMd: candidate.bodyMd,
      dominionId: input.dominionId,
      sourceMetadata: {
        externalId: `chat-distill:${input.date}:${input.threadId}:${index + 1}`,
        chatDistill: { threadId: input.threadId, date: input.date, messageSeqs: input.messageSeqs },
        ...(input.askId ? { askId: input.askId } : {}),
      },
    }, { origin }))
  }
  return captures
}

export async function runChatDistillForUser(
  userId: string,
  options: ChatDistillOptions = {},
): Promise<ChatDistillRunResult> {
  const target = resolveChatDistillDate(options.date)
  const dryRun = options.dryRun ?? false
  const { threads, askIdByThreadId } = await gatherChatDistillThreads(userId, target)
  const results: ChatDistillThreadResult[] = []

  for (const thread of threads) {
    const messageSeqs = thread.messages.map((message) => message.seq)
    const base = { threadId: thread.id, title: thread.title, messageSeqs }

    try {
      const skipReason = chatDistillSkipReason(thread)
      if (skipReason) {
        results.push({ ...base, status: 'skipped', reason: skipReason })
        continue
      }
      // The thinking routine already distilled this thread on Max.
      if (await isJobDone(userId, chatDistillJobKey(thread.id, target.date))) {
        results.push({ ...base, status: 'existing', reason: 'answered on Max' })
        continue
      }

      const prompt = buildChatDistillUserPrompt(thread, target.date, askIdByThreadId.get(thread.id))
      // No temperature: current-gen Claude models 400 on non-default values
      // (same reason PR #84 stripped it from the synthesis call sites).
      const modelInput = {
        system: CHAT_DISTILL_SYSTEM_PROMPT,
        prompt,
        cacheSystem: true,
        maxTokens: CHAT_DISTILL_MAX_TOKENS,
      }
      if (dryRun) {
        results.push({ ...base, status: 'dry_run', modelInput })
        continue
      }

      const { provider } = await getProviderForTask(userId, {
        taskType: 'reflect',
        dominionId: thread.dominionId,
      })
      const response = await provider.ask(modelInput)
      const candidates = parseChatDistillResponse(response.text.trim())
      if (candidates.length === 0) {
        results.push({ ...base, status: 'skipped', reason: 'no durable operator signal' })
        continue
      }

      const captures = await persistChatDistillReflections(userId, {
        threadId: thread.id,
        dominionId: thread.dominionId,
        date: target.date,
        messageSeqs,
        askId: askIdByThreadId.get(thread.id),
        originKind: chatDistillOriginKind(thread),
      }, candidates)

      const reflectionsCreated = captures.filter((capture) => capture.created).length
      results.push({
        ...base,
        status: reflectionsCreated > 0 ? 'created' : 'existing',
        reflectionIds: captures.map((capture) => capture.memory.id),
        reflectionsCreated,
      })
    } catch (error) {
      if (error instanceof AiCredentialMissingError) {
        results.push({ ...base, status: 'skipped', reason: 'no BYOK credential' })
      } else if (error instanceof AiCredentialDecryptError) {
        results.push({ ...base, status: 'skipped', reason: 'key undecryptable' })
      } else {
        results.push({
          ...base,
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
        })
        await writeCronFailureTrace(userId, {
          cronName: 'chat-distill',
          dominionId: thread.dominionId,
          reason: 'thread_distill_failed',
          error,
        })
      }
    }
  }

  // Liveness for the health scorecard (cron path only — a dry run proves
  // nothing). Thread errors already wrote a failure trace, which wins.
  if (!dryRun && !results.some((result) => result.status === 'error')) {
    const worked = results.some((result) => result.status === 'created' || result.status === 'existing')
    await writeCronSuccessTrace(userId, {
      cronName: 'chat-distill',
      ...(worked ? {} : { outcome: 'skipped' as const, skipReason: threads.length === 0 ? 'no threads' : 'no durable signal' }),
    })
  }

  return {
    date: target.date,
    dryRun,
    reflectionsCreated: results.reduce((count, result) => count + (result.reflectionsCreated ?? 0), 0),
    threads: results,
  }
}

export { parseChatDistillResponse }
