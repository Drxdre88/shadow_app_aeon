import { z } from 'zod'
import { findColdRead, insertColdRead } from '@/lib/data/cold-reads'
import { getChatThread } from '@/lib/data/kairos-chat'
import { listJobs } from '@/lib/data/thinking-jobs'
import {
  SECOND_LOOK_MAX_AGE_MS,
  SECOND_LOOK_TITLE,
  buildSecondLookMessage,
  compareStances,
  type ColdReadDelivery,
} from '@/lib/kairos/cold-read/compare'
import { coldReadMode, type ColdReadMode } from '@/lib/kairos/cold-read/flag'
import {
  COLD_READ_MAX_OUTPUT_TOKENS,
  COLD_READ_SYSTEM_PROMPT,
  buildColdReadPrompt,
  parseColdReadText,
  type ColdVerdict,
} from '@/lib/kairos/cold-read/prompt'
import { STANCE_VALUES, type Stance } from '@/lib/kairos/cold-read/stance'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { londonDayStart } from '../deadlines'
import { errorReason } from './_errors'

// Cold read (KAIROS_COLD_READ, deep tier, brain routine). plan: chat jobs
// done in the last 24h whose reply carried a hidden stance tag, decision
// turns first then newest, at most 3 cold reads per London day, one per
// chat job (key cold_read:<chatJobId>). The prompt carries ONLY the owner's
// own messages. apply: compare warm vs cold, record a trace row, and — with
// the flag at '1', a material disagreement and a turn under 12h old — send a
// "Second look" through the normal speak path (never into the chat thread).
// Never belief evidence. No fallback: a missed cold read is dropped.

export const COLD_READ_KIND: ThinkingJobKind = 'cold_read'
export const COLD_READ_DAILY_CAP = 3
export const COLD_READ_DEADLINE_MINUTES = 18 * 60
const LOOKBACK_MS = 24 * 60 * 60 * 1000
const EARLIER_OWNER_MESSAGES = 2
const JOB_SCAN_LIMIT = 100

const DECISION_RE = /\b(should i|agree\b|i'?m going to|i am going to|i'?ve decided|i have decided|good idea)/i

export function isDecisionTurn(body: string): boolean {
  return DECISION_RE.test(body)
}

export function coldReadKey(chatJobId: string): string {
  return `${COLD_READ_KIND}:${chatJobId}`
}

const stanceSchema = z.object({ value: z.enum(STANCE_VALUES), gist: z.string() })

const chatContextSchema = z.object({
  channel: z.enum(['telegram', 'web']).default('telegram'),
  threadId: z.string().min(1),
  userSeq: z.number().int().positive(),
  userBody: z.string(),
})

const contextSchema = z.object({
  chatJobId: z.string().min(1),
  threadId: z.string().min(1),
  userSeq: z.number().int().positive(),
  channel: z.enum(['telegram', 'web']),
  warm: stanceSchema,
  askedAt: z.string().min(1),
})
type ColdReadContext = z.infer<typeof contextSchema>

export interface ColdReadCandidate {
  chatJobId: string
  askedAt: Date
  warm: Stance
  chat: z.infer<typeof chatContextSchema>
}

// Tagged done chat jobs without a cold read yet, decision turns first, then
// newest, capped at `remaining`.
export function pickColdReadCandidates(
  chatJobs: readonly ThinkingJobRow[],
  existingKeys: ReadonlySet<string>,
  remaining: number,
): ColdReadCandidate[] {
  if (remaining <= 0) return []
  const candidates: ColdReadCandidate[] = []
  for (const job of chatJobs) {
    if (job.kind !== 'chat' || job.status !== 'done') continue
    if (existingKeys.has(coldReadKey(job.id))) continue
    const stance = stanceSchema.safeParse(job.output?.stance)
    const chat = chatContextSchema.safeParse(job.input?.context)
    if (!stance.success || !chat.success) continue
    candidates.push({ chatJobId: job.id, askedAt: job.createdAt, warm: stance.data, chat: chat.data })
  }
  candidates.sort((a, b) => {
    const d = Number(isDecisionTurn(b.chat.userBody)) - Number(isDecisionTurn(a.chat.userBody))
    return d !== 0 ? d : b.askedAt.getTime() - a.askedAt.getTime()
  })
  return candidates.slice(0, remaining)
}

async function ownerMessages(userId: string, c: ColdReadCandidate): Promise<string[]> {
  const thread = await getChatThread(userId, c.chat.threadId).catch(() => null)
  const earlier = (thread?.messages ?? [])
    .filter((m) => m.role === 'user' && m.seq < c.chat.userSeq)
    .slice(-EARLIER_OWNER_MESSAGES)
    .map((m) => m.content)
  return [...earlier, c.chat.userBody]
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (coldReadMode() === 'off') return []
  const dayStart = londonDayStart(now)
  const since = new Date(Math.min(now.getTime() - LOOKBACK_MS, dayStart.getTime()))
  const [chatJobs, coldJobs] = await Promise.all([
    listJobs(userId, { kind: 'chat', status: 'done', since, limit: JOB_SCAN_LIMIT }),
    listJobs(userId, { kind: COLD_READ_KIND, since, limit: JOB_SCAN_LIMIT }),
  ])
  const usedToday = coldJobs.filter((j) => j.createdAt.getTime() >= dayStart.getTime()).length
  const recentChat = chatJobs.filter((j) => j.createdAt.getTime() >= now.getTime() - LOOKBACK_MS)
  const picked = pickColdReadCandidates(recentChat, new Set(coldJobs.map((j) => j.externalKey)), COLD_READ_DAILY_CAP - usedToday)

  const specs: ThinkingJobSpec[] = []
  for (const c of picked) {
    specs.push({
      kind: COLD_READ_KIND,
      dominionId: null,
      externalKey: coldReadKey(c.chatJobId),
      deadlineMinutes: COLD_READ_DEADLINE_MINUTES,
      input: {
        system: COLD_READ_SYSTEM_PROMPT,
        prompt: buildColdReadPrompt(await ownerMessages(userId, c)),
        validMemoryIds: [],
        maxOutputTokens: COLD_READ_MAX_OUTPUT_TOKENS,
        context: {
          chatJobId: c.chatJobId,
          threadId: c.chat.threadId,
          userSeq: c.chat.userSeq,
          channel: c.chat.channel,
          warm: c.warm,
          askedAt: c.askedAt.toISOString(),
        } satisfies ColdReadContext,
      },
    })
  }
  return specs
}

async function speakSecondLook(userId: string, ctx: ColdReadContext, cold: ColdVerdict): Promise<ColdReadDelivery> {
  if (cold.stance === 'insufficient') return 'insufficient'
  try {
    const out = await deliverKairosSpeak(userId, {
      title: SECOND_LOOK_TITLE,
      message: buildSecondLookMessage(ctx.warm, { ...cold, stance: cold.stance }),
      kind: 'notify',
      urgency: 'normal',
      force: false,
      opsAlert: false,
      digest: false,
      externalId: `cold-read:${ctx.chatJobId}`,
    })
    if (out.status !== 200) return 'blocked'
    return out.body.alreadyDelivered ? 'already' : 'sent'
  } catch (err) {
    console.error('[kairos:cold-read] second look failed', errorReason(err))
    return 'failed'
  }
}

async function decideDelivery(
  userId: string,
  mode: ColdReadMode,
  ctx: ColdReadContext,
  cold: ColdVerdict | null,
  disagree: boolean,
  now: Date,
): Promise<ColdReadDelivery> {
  if (!cold) return 'unparsed'
  if (cold.stance === 'insufficient') return 'insufficient'
  if (!disagree) return 'agree'
  if (mode !== 'speak') return 'audit'
  const askedAt = Date.parse(ctx.askedAt)
  if (!Number.isFinite(askedAt) || now.getTime() - askedAt > SECOND_LOOK_MAX_AGE_MS) return 'stale'
  return speakSecondLook(userId, ctx, cold)
}

function renderBody(ctx: ColdReadContext, cold: ColdVerdict | null, disagree: boolean, delivered: ColdReadDelivery): string {
  const lines = [
    `Warm: ${ctx.warm.value}${ctx.warm.gist ? ` — ${ctx.warm.gist}` : ''}`,
    cold ? `Cold: ${cold.stance} (confidence ${cold.confidence})` : 'Cold: unparsed',
    `Disagree: ${disagree ? 'yes' : 'no'} · delivered: ${delivered}`,
  ]
  if (cold) {
    lines.push('', `Restated: ${cold.restated}`)
    if (cold.verdict) lines.push('', `Verdict: ${cold.verdict}`)
    for (const r of cold.reasons) lines.push(`- ${r}`)
  }
  return lines.join('\n')
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const parsedCtx = contextSchema.safeParse(job.input?.context)
  if (!parsedCtx.success) return { ok: false, reason: `bad_job: ${errorReason(parsedCtx.error)}` }
  const ctx = parsedCtx.data
  const mode = coldReadMode()
  if (mode === 'off') return { ok: true, memoryIds: [], output: { skipped: 'flag_off', answeredBy } }

  const existing = await findColdRead(job.userId, job.externalKey)
  if (existing) return { ok: true, memoryIds: [existing.id], output: { duplicate: true, answeredBy } }

  const cold = parseColdReadText(text)
  const { gap, disagree } = cold ? compareStances(ctx.warm.value, cold.stance, cold.confidence) : { gap: null, disagree: false }
  const delivered = await decideDelivery(job.userId, mode, ctx, cold, disagree, new Date())
  const status = cold ? 'ok' : 'unparsed'

  const { memoryId } = await insertColdRead(job.userId, {
    externalKey: job.externalKey,
    title: `Cold read — ${cold ? (disagree ? 'disagreed' : cold.stance === 'insufficient' ? 'insufficient' : 'agreed') : 'unparsed'}`,
    bodyMd: renderBody(ctx, cold, disagree, delivered),
    summary: `Warm ${ctx.warm.value} · cold ${cold?.stance ?? 'unparsed'} · ${delivered}`,
    coldRead: {
      v: 1,
      status,
      mode,
      chatJobId: ctx.chatJobId,
      threadId: ctx.threadId,
      userSeq: ctx.userSeq,
      channel: ctx.channel,
      askedAt: ctx.askedAt,
      warm: ctx.warm,
      cold,
      gap,
      disagree,
      delivered,
      jobId: job.id,
      answeredBy,
    },
  })
  return { ok: true, memoryIds: [memoryId], output: { status, disagree, delivered, answeredBy } }
}

export const coldReadHandler: ThinkingJobHandler = {
  kind: COLD_READ_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed cold read is dropped' }),
}
