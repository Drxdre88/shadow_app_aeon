import { insertCardTreeProposal } from '@/lib/data/card-tree-proposals'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { announceCardTree } from '@/lib/kairos/card-tree/announce'
import { groundCardTree } from '@/lib/kairos/card-tree/ground'
import { parseCardTreeText } from '@/lib/kairos/card-tree/prompt'
import { cardTreeTitle, renderCardTreeBody } from '@/lib/kairos/card-tree/render'
import { CARD_TREE_EXPIRY_MS, CARD_TREE_KIND, cardTreeContextSchema, type CardTreeAnswer } from '@/lib/kairos/card-tree/types'
import type { ApplyOutcome, ThinkingAnsweredBy, ThinkingJobHandler, ThinkingJobRow, ThinkingJobSpec } from '@/lib/kairos/engine/types'
import { errorReason } from './_errors'

// Card tree (Workforce L4, deep tier, brain routine, on request only). plan
// queues nothing: requestCardTree (lib/data/card-tree.ts) enqueues each job
// when the owner asks. apply grounds the drafted tree on the board (existing
// labels only, ≤12 cards, no dependency loops) and stores it as a PENDING
// proposal for 7 days, announced through the gated proposal path. It never
// creates a card — only the owner's Approve does. No fallback (no paid calls).

export const CARD_TREE_CRON = 'card-tree'

async function skipped(job: ThinkingJobRow, reason: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  await writeCronSuccessTrace(job.userId, { cronName: CARD_TREE_CRON, outcome: 'skipped', skipReason: reason })
  return { ok: true, memoryIds: [], output: { skipped: reason, answeredBy } }
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = cardTreeContextSchema.safeParse(job.input?.context)
  if (!ctx.success) return { ok: false, reason: 'bad_job: card_tree job has no context' }

  let answer: CardTreeAnswer
  try {
    answer = parseCardTreeText(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  const grounded = groundCardTree(answer, ctx.data)
  if (!grounded.ok) return skipped(job, grounded.reason, answeredBy)

  const now = new Date()
  const tree = grounded.tree
  const title = cardTreeTitle(tree)
  const expiresAt = new Date(now.getTime() + CARD_TREE_EXPIRY_MS).toISOString()
  const { id, written } = await insertCardTreeProposal(job.userId, {
    externalKey: `${CARD_TREE_KIND}_proposal:${job.id}`,
    title,
    bodyMd: renderCardTreeBody(tree),
    tree,
    expiresAt,
    jobId: job.id,
    now,
  })

  if (written) {
    try {
      await announceCardTree(job.userId, { id, title, expiresAt, tree }, now)
    } catch (err) {
      console.error('[kairos:card-tree] sending the proposal to Telegram failed:', errorReason(err))
    }
  }

  await writeCronSuccessTrace(job.userId, {
    cronName: CARD_TREE_CRON,
    outcome: 'ok',
    details: { proposalId: id, projectId: tree.projectId, cards: tree.cards.length, dropped: grounded.dropped },
  })
  return { ok: true, memoryIds: [id], output: { proposalId: id, cards: tree.cards.length, dropped: grounded.dropped, answeredBy } }
}

export const cardTreeHandler: ThinkingJobHandler = {
  kind: CARD_TREE_KIND,
  plan: async (): Promise<ThinkingJobSpec[]> => [],
  apply,
  fallback: async (): Promise<ApplyOutcome> => ({ ok: false, reason: 'no fallback — no draft is made' }),
}
