import { listChatThreadsWithMessagesOn } from '@/lib/data/kairos-chat'
import { captureMemory } from '@/lib/data/memories'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialDecryptError, AiCredentialMissingError } from '@/lib/ai/router'
import {
  CHAT_DISTILL_SYSTEM_PROMPT,
  buildChatDistillUserPrompt,
  parseChatDistillResponse,
} from './chat-distill-prompt'

const DAY_MS = 86_400_000
const MAX_MESSAGES_PER_THREAD = 80
// Must comfortably fit 5 max-length reflections (~2500+ tokens of JSON) —
// the cap genuinely binds since the maxOutputTokens fix, and a truncated
// reply fails the whole thread's parse instead of degrading.
const MAX_OUTPUT_TOKENS = 4000

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
    temperature: number
  }
}

export interface ChatDistillRunResult {
  date: string
  dryRun: boolean
  reflectionsCreated: number
  threads: ChatDistillThreadResult[]
}

function resolveDate(date?: string): { date: string; start: Date; end: Date } {
  const target = date ?? new Date(Date.now() - DAY_MS).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('date must be YYYY-MM-DD')
  const start = new Date(`${target}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== target) {
    throw new Error('date must be a valid UTC calendar date')
  }
  return { date: target, start, end: new Date(start.getTime() + DAY_MS) }
}

export async function runChatDistillForUser(
  userId: string,
  options: ChatDistillOptions = {},
): Promise<ChatDistillRunResult> {
  const target = resolveDate(options.date)
  const dryRun = options.dryRun ?? false
  const threads = await listChatThreadsWithMessagesOn(
    userId,
    target.start,
    target.end,
    MAX_MESSAGES_PER_THREAD,
  )
  const results: ChatDistillThreadResult[] = []

  for (const thread of threads) {
    const messageSeqs = thread.messages.map((message) => message.seq)
    const base = { threadId: thread.id, title: thread.title, messageSeqs }

    try {
      if (thread.messages.length === 0) {
        results.push({ ...base, status: 'skipped', reason: 'no messages' })
        continue
      }
      if (!thread.messages.some((message) => message.role === 'user' && message.content.trim())) {
        results.push({ ...base, status: 'skipped', reason: 'no operator messages' })
        continue
      }

      const prompt = buildChatDistillUserPrompt(thread, target.date)
      const modelInput = {
        system: CHAT_DISTILL_SYSTEM_PROMPT,
        prompt,
        cacheSystem: true,
        maxTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.1,
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

      const captures = []
      for (const [index, candidate] of candidates.entries()) {
        captures.push(await captureMemory(userId, {
          type: 'reflection',
          streamClass: 'reflection',
          source: 'cron',
          title: candidate.title,
          bodyMd: candidate.bodyMd,
          dominionId: thread.dominionId,
          sourceMetadata: {
            externalId: `chat-distill:${target.date}:${thread.id}:${index + 1}`,
            chatDistill: { threadId: thread.id, date: target.date, messageSeqs },
          },
        }))
      }

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
      }
    }
  }

  return {
    date: target.date,
    dryRun,
    reflectionsCreated: results.reduce((count, result) => count + (result.reflectionsCreated ?? 0), 0),
    threads: results,
  }
}

export { parseChatDistillResponse }
