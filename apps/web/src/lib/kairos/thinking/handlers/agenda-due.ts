import { z } from 'zod'
import { createKairosAskMemory, listOpenKairosAsks } from '@/lib/data/ask'
import { findGoal } from '@/lib/data/goals'
import { captureMemory, findMemoriesByIds } from '@/lib/data/memories'
import type { AgendaResult, KairosAgendaItem } from '@/lib/data/validators/kairos-agenda'
import { createAgendaItems } from '@/lib/kairos/agenda/create'
import {
  AGENDA_DUE_KIND,
  agendaDueJobKey,
  markAgendaMissed,
  planAgendaDue,
  readFiredAgendaItem,
  settleAgendaItem,
} from '@/lib/kairos/agenda/fire'
import { agendaEnabled } from '@/lib/kairos/agenda/flag'
import {
  AGENDA_DUE_MAX_OUTPUT_TOKENS,
  AGENDA_DUE_SYSTEM_PROMPT,
  buildAgendaDuePrompt,
  parseAgendaDueText,
  type AgendaDueOutput,
  type AgendaPromptBasis,
  type AgendaPromptGoal,
} from '@/lib/kairos/agenda/prompt'
import { AGENDA_DUE_DEADLINE_MINUTES } from '@/lib/kairos/agenda/rules'
import { ASK_BACKLOG_MAX } from '@/lib/kairos/ask-mine'
import { deliverKairosSpeak } from '@/lib/kairos/speak'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { errorReason } from './_errors'
import { agendaDueThoughts, withThoughts } from '../stage-thoughts'

// Horae on the thinking queue (deep tier): one job per due agenda item, key
// agenda_due:<itemId>, so an item fires exactly once (the item is marked
// 'fired' under the row lock before the spec is returned). apply NEVER acts:
// it may only write an observation (captureMemory), one owner question
// (createKairosAskMemory, while the ask backlog is under 10) or one message
// (deliverKairosSpeak, force:false — a 429 becomes a thought, downgraded),
// plus at most one rebook at depth ≤1. abandon → missed. No fallback.
// Registered on the brain routine (deep tier); planned by claims and the
// hourly sweep alike — planAgendaDue returns nothing while the flags are off.

const KIND: ThinkingJobKind = AGENDA_DUE_KIND
const ASK_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000

const contextSchema = z.object({
  itemId: z.string().uuid(),
  seq: z.number().int().positive(),
  what: z.string(),
  dominionId: z.string().nullable(),
  goalId: z.string().nullable(),
  basisIds: z.array(z.string()),
  rebookDepth: z.union([z.literal(0), z.literal(1)]),
})
type AgendaDueContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): AgendaDueContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

const refersTo = (target: string) => ({ type: 'refers_to' as const, target, target_kind: 'memory' as const })

async function loadPromptInputs(userId: string, item: KairosAgendaItem): Promise<{ goal: AgendaPromptGoal | null; basis: AgendaPromptBasis[] }> {
  try {
    const [goal, rows] = await Promise.all([
      item.goalId ? findGoal(userId, item.goalId) : Promise.resolve(null),
      findMemoriesByIds(item.basisIds, userId),
    ])
    return {
      goal: goal ? { title: goal.title, question: goal.meta.question, state: goal.meta.state } : null,
      basis: rows.map((r) => ({ id: r.id, title: r.title, summary: r.summary ?? null })),
    }
  } catch (err) {
    // The item is already claimed: a read failure must not strand it.
    console.warn('[kairos:agenda-due] prompt inputs unavailable:', errorReason(err))
    return { goal: null, basis: [] }
  }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const items = await planAgendaDue(userId, now)
  const specs: ThinkingJobSpec[] = []
  for (const item of items) {
    const { goal, basis } = await loadPromptInputs(userId, item)
    specs.push({
      kind: KIND,
      dominionId: item.dominionId,
      externalKey: agendaDueJobKey(item.id),
      deadlineMinutes: AGENDA_DUE_DEADLINE_MINUTES,
      input: {
        system: AGENDA_DUE_SYSTEM_PROMPT,
        prompt: buildAgendaDuePrompt({ item, now, goal, basis, canRebook: item.rebookDepth === 0 }),
        validMemoryIds: [...basis.map((b) => b.id), ...(item.goalId ? [item.goalId] : [])],
        maxOutputTokens: AGENDA_DUE_MAX_OUTPUT_TOKENS,
        context: {
          itemId: item.id,
          seq: item.seq,
          what: item.what,
          dominionId: item.dominionId,
          goalId: item.goalId ?? null,
          basisIds: item.basisIds,
          rebookDepth: item.rebookDepth,
        } satisfies AgendaDueContext,
      },
    })
  }
  return specs
}

async function writeThought(job: ThinkingJobRow, c: AgendaDueContext, text: string, answeredBy: ThinkingAnsweredBy, downgradedFrom?: 'ask' | 'message'): Promise<AgendaResult> {
  const { memory } = await captureMemory(job.userId, {
    title: `Horae A${c.seq}: ${c.what}`.slice(0, 255),
    bodyMd: text,
    summary: text.slice(0, 1000),
    type: 'observation',
    source: 'cron',
    streamClass: 'agentic',
    dominionId: c.dominionId,
    links: [...c.basisIds, ...(c.goalId ? [c.goalId] : [])].map(refersTo),
    tags: ['agenda'],
    sourceMetadata: {
      kind: 'agenda_due',
      externalId: `agenda:${c.itemId}`,
      itemId: c.itemId,
      seq: c.seq,
      jobId: job.id,
      answeredBy,
      ...(downgradedFrom ? { downgradedFrom } : {}),
    },
  })
  return { kind: 'thought', memoryId: memory.id, ...(downgradedFrom ? { downgraded: true as const } : {}) }
}

async function writeAsk(job: ThinkingJobRow, c: AgendaDueContext, text: string, answeredBy: ThinkingAnsweredBy, now: Date): Promise<AgendaResult> {
  const open = await listOpenKairosAsks(job.userId, now)
  if (open.length >= ASK_BACKLOG_MAX) return writeThought(job, c, text, answeredBy, 'ask')
  const memoryId = await createKairosAskMemory(job.userId, {
    question: text,
    dominionId: c.dominionId,
    aetherMemoryId: '',
    sourceThoughtId: null,
    sourceMemoryIds: c.basisIds,
    askedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ASK_EXPIRY_MS).toISOString(),
    externalId: `agenda:${c.itemId}`,
  })
  return { kind: 'ask', memoryId }
}

async function writeMessage(job: ThinkingJobRow, c: AgendaDueContext, text: string, answeredBy: ThinkingAnsweredBy): Promise<AgendaResult> {
  const outcome = await deliverKairosSpeak(job.userId, {
    title: `Vorath · Horae A${c.seq}`,
    message: text,
    kind: 'notify',
    urgency: 'normal',
    force: false,
    opsAlert: false,
    digest: false,
    externalId: `kairos-agenda:${c.itemId}`,
  })
  if (outcome.status === 200) return { kind: 'message', memoryId: outcome.body.id }
  return writeThought(job, c, text, answeredBy, 'message')
}

async function writeResult(job: ThinkingJobRow, c: AgendaDueContext, out: AgendaDueOutput, answeredBy: ThinkingAnsweredBy, now: Date): Promise<AgendaResult> {
  switch (out.result) {
    case 'nothing':
      return { kind: 'nothing' }
    case 'thought':
      return writeThought(job, c, out.text, answeredBy)
    case 'ask':
      return writeAsk(job, c, out.text, answeredBy, now)
    case 'message':
      return writeMessage(job, c, out.text, answeredBy)
  }
}

async function rebook(job: ThinkingJobRow, item: KairosAgendaItem, out: AgendaDueOutput, now: Date): Promise<string | null> {
  if (!out.rebook || item.rebookDepth !== 0) return null
  try {
    const res = await createAgendaItems(job.userId, [{
      what: out.rebook.what ?? item.what,
      date: out.rebook.date,
      slot: out.rebook.slot,
      basisIds: item.basisIds,
      dominionId: item.dominionId,
      ...(item.goalId ? { goalId: item.goalId } : {}),
    }], { kind: 'agenda_due', jobId: job.id, ...(item.goalId ? { goalId: item.goalId } : {}) }, { now, rebookDepth: 1, validBasisIds: new Set(item.basisIds) })
    return res.created[0] ? `A${res.created[0].seq}` : `rejected:${res.rejected[0]?.reason ?? 'unknown'}`
  } catch (err) {
    console.error('[kairos:agenda-due] rebook failed:', errorReason(err))
    return 'rejected:error'
  }
}

export async function applyAgendaDue(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy, now: Date = new Date()): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: agenda_due job has no item context' }
  const item = await readFiredAgendaItem(job.userId, c.itemId)
  // Cancelled by the owner (or already settled) since planning: write nothing.
  if (!item) return { ok: true, memoryIds: [], output: { skipped: 'not_fired', itemId: c.itemId, answeredBy } }
  if (!agendaEnabled()) {
    await markAgendaMissed(job.userId, c.itemId, job.id, now)
    return { ok: true, memoryIds: [], output: { skipped: 'agenda_off', itemId: c.itemId, answeredBy } }
  }

  let out: AgendaDueOutput
  try {
    out = parseAgendaDueText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  const result = await writeResult(job, c, out, answeredBy, now)
  await settleAgendaItem(job.userId, c.itemId, job.id, result, now)
  const rebooked = await rebook(job, item, out, now)
  return withThoughts({
    ok: true,
    memoryIds: result.memoryId ? [result.memoryId] : [],
    output: { itemId: c.itemId, result, ...(rebooked ? { rebooked } : {}), answeredBy },
  }, agendaDueThoughts(out, c.goalId))
}

export const agendaDueHandler: ThinkingJobHandler = {
  kind: KIND,
  plan,
  apply: (job, text, answeredBy) => applyAgendaDue(job, text, answeredBy),
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed check-in is fine' }),
  async abandon(job) {
    const c = readContext(job)
    if (c) await markAgendaMissed(job.userId, c.itemId, job.id)
    return []
  },
}
