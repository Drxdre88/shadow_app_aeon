import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boardColumns, boardTasks, checklistItems, labels, taskDependencies, taskLabels, thinkingJobs } from '@/lib/db/schema'
import { cardTreeMode } from '@/lib/kairos/card-tree/flag'
import { buildCardTreeJob, CARD_TREE_MAX_OUTPUT_TOKENS, CARD_TREE_SYSTEM_PROMPT } from '@/lib/kairos/card-tree/prompt'
import { CARD_TREE_KIND, CARD_TREE_OPEN_CARDS_MAX, type CardTree } from '@/lib/kairos/card-tree/types'
import { claimCardTreeInTx, stampCreatedTasksInTx } from './card-tree-proposals'
import { canEditProject } from './hangar-access'
import { findProjectBasic, touchProject } from './projects'
import { upsertJob } from './thinking-jobs'

// Goal → card tree (Workforce L4). requestCardTree queues an on-demand
// card_tree job for Vorath; createCardTree is the ONLY place the tree becomes
// cards, called once the owner approves. Both re-check edit access here, so
// every surface (MCP, REST, server action, Telegram) gets the same refusal.

export const CARD_TREE_DEADLINE_MINUTES = 24 * 60
export const CARD_TREE_QUEUED_MESSAGE = 'Vorath will draft it on his next run; you approve before anything is created.'
export const CARD_TREE_FORBIDDEN = 'You need editor access to this board to plan a goal on it'
export const CARD_TREE_OFF = 'Planning a goal with Vorath is switched off'

export type RequestCardTreeResult =
  | { ok: true; jobId: string; status: string; alreadyRequested: boolean; message: string }
  | { ok: false; reason: 'off' | 'forbidden' | 'busy'; message: string }

export const CARD_TREE_OPEN_MAX = 3
export const CARD_TREE_BUSY = `Vorath already has ${CARD_TREE_OPEN_MAX} goals waiting to be planned; try again once he has drafted them`
const OPEN_JOB_STATUSES = ['queued', 'claimed'] as const

export const cardTreeJobKey = (projectId: string, goal: string) =>
  `${CARD_TREE_KIND}:${projectId}:${createHash('sha256').update(goal.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex').slice(0, 16)}`

async function readBoard(projectId: string) {
  const [columns, labelRows, open] = await Promise.all([
    db.select({ name: boardColumns.name }).from(boardColumns).where(eq(boardColumns.projectId, projectId)).orderBy(asc(boardColumns.orderIndex)),
    db.select({ name: labels.name }).from(labels).where(eq(labels.projectId, projectId)).orderBy(asc(labels.name)),
    db.select({ name: boardTasks.name })
      .from(boardTasks)
      .where(and(eq(boardTasks.projectId, projectId), isNull(boardTasks.archivedAt), isNull(boardTasks.completedAt)))
      .orderBy(asc(boardTasks.orderIndex))
      .limit(CARD_TREE_OPEN_CARDS_MAX),
  ])
  return { columns: columns.map((c) => c.name), labels: labelRows.map((l) => l.name), openCards: open.map((t) => t.name) }
}

async function findJobByKey(userId: string, externalKey: string) {
  const [row] = await db
    .select({ id: thinkingJobs.id, status: thinkingJobs.status })
    .from(thinkingJobs)
    .where(and(eq(thinkingJobs.userId, userId), eq(thinkingJobs.externalKey, externalKey)))
    .limit(1)
  return row ?? null
}

async function countOpenCardTreeJobs(userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(thinkingJobs)
    .where(and(
      eq(thinkingJobs.userId, userId),
      eq(thinkingJobs.kind, CARD_TREE_KIND),
      inArray(thinkingJobs.status, [...OPEN_JOB_STATUSES]),
      gt(thinkingJobs.deadlineAt, now),
    ))
  return row?.n ?? 0
}

const isOpenStatus = (status: string) => (OPEN_JOB_STATUSES as readonly string[]).includes(status)

export async function requestCardTree(
  userId: string,
  input: { projectId: string; goal: string },
  now: Date = new Date(),
): Promise<RequestCardTreeResult> {
  if (cardTreeMode() === 'off') return { ok: false, reason: 'off', message: CARD_TREE_OFF }
  if (!(await canEditProject(input.projectId, userId))) return { ok: false, reason: 'forbidden', message: CARD_TREE_FORBIDDEN }
  const project = await findProjectBasic(input.projectId)
  if (!project) return { ok: false, reason: 'forbidden', message: CARD_TREE_FORBIDDEN }

  const board = await readBoard(input.projectId)
  const { prompt, context } = buildCardTreeJob({ projectId: project.id, projectName: project.name, goal: input.goal, ...board })
  const baseKey = cardTreeJobKey(project.id, input.goal)
  const existing = await findJobByKey(userId, baseKey)
  if (existing && isOpenStatus(existing.status)) {
    return {
      ok: true,
      jobId: existing.id,
      status: existing.status,
      alreadyRequested: true,
      message: `This goal was already sent to Vorath for this board. ${CARD_TREE_QUEUED_MESSAGE}`,
    }
  }
  if ((await countOpenCardTreeJobs(userId, now)) >= CARD_TREE_OPEN_MAX) return { ok: false, reason: 'busy', message: CARD_TREE_BUSY }
  // A finished, failed, vetoed or expired request for the same goal is asked again under a fresh key.
  const externalKey = existing ? `${baseKey}:${now.getTime().toString(36)}` : baseKey
  const job = await upsertJob(userId, {
    kind: CARD_TREE_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: CARD_TREE_DEADLINE_MINUTES,
    input: { system: CARD_TREE_SYSTEM_PROMPT, prompt, maxOutputTokens: CARD_TREE_MAX_OUTPUT_TOKENS, context },
  }, now)
  if (job) return { ok: true, jobId: job.id, status: job.status, alreadyRequested: false, message: CARD_TREE_QUEUED_MESSAGE }

  const raced = await findJobByKey(userId, externalKey)
  if (!raced) throw new Error('card tree job neither inserted nor found')
  return {
    ok: true,
    jobId: raced.id,
    status: raced.status,
    alreadyRequested: true,
    message: `This goal was already sent to Vorath for this board. ${CARD_TREE_QUEUED_MESSAGE}`,
  }
}

export type CreateCardTreeResult =
  | { ok: true; taskIds: string[] }
  | { ok: false; reason: 'forbidden' | 'already_decided' }

/**
 * Creates the approved tree in ONE transaction: the proposal's pending →
 * approved claim, every card (first column by order, existing labels only,
 * checklist items) and every dependency. Any failure rolls all of it back.
 */
export async function createCardTree(
  ownerUserId: string,
  proposalId: string,
  tree: CardTree,
  now: Date = new Date(),
): Promise<CreateCardTreeResult> {
  if (!(await canEditProject(tree.projectId, ownerUserId))) return { ok: false, reason: 'forbidden' }
  const projectId = tree.projectId

  const taskIds = await db.transaction(async (tx) => {
    if (!(await claimCardTreeInTx(tx, ownerUserId, proposalId, now))) return null
    const [firstColumn] = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))
      .orderBy(asc(boardColumns.orderIndex))
      .limit(1)
    const labelRows = await tx.select({ id: labels.id, name: labels.name }).from(labels).where(eq(labels.projectId, projectId))
    const labelId = new Map(labelRows.map((l) => [l.name.trim().toLowerCase(), l.id]))
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${boardTasks.orderIndex}), -1)` })
      .from(boardTasks)
      .where(eq(boardTasks.projectId, projectId))

    let orderIndex = Number(maxRow?.max ?? -1) + 1
    const idByKey = new Map(tree.cards.map((c) => [c.key, randomUUID()]))
    await tx.insert(boardTasks).values(tree.cards.map((c) => ({
      id: idByKey.get(c.key)!,
      projectId,
      name: c.name,
      description: c.description || null,
      columnId: firstColumn?.id ?? null,
      status: 'todo',
      priority: c.priority,
      orderIndex: orderIndex++,
      metadata: { cardTree: { proposalId, key: c.key } },
      createdAt: now,
      updatedAt: now,
    })))

    const labelPairs = tree.cards.flatMap((c) => [...new Set(c.labels.map((n) => labelId.get(n.trim().toLowerCase())).filter((id): id is string => Boolean(id)))]
      .map((id) => ({ taskId: idByKey.get(c.key)!, labelId: id })))
    if (labelPairs.length > 0) await tx.insert(taskLabels).values(labelPairs).onConflictDoNothing()

    const items = tree.cards.flatMap((c) => c.checklist.map((title, i) => ({ taskId: idByKey.get(c.key)!, title, orderIndex: i })))
    if (items.length > 0) await tx.insert(checklistItems).values(items)

    const deps = tree.cards.flatMap((c) => c.dependsOn
      .filter((k) => idByKey.has(k) && k !== c.key)
      .map((k) => ({ blockerTaskId: idByKey.get(k)!, blockedTaskId: idByKey.get(c.key)! })))
    if (deps.length > 0) await tx.insert(taskDependencies).values(deps).onConflictDoNothing()

    const ids = [...idByKey.values()]
    await stampCreatedTasksInTx(tx, ownerUserId, proposalId, ids)
    return ids
  })
  if (!taskIds) return { ok: false, reason: 'already_decided' }

  await touchProject(projectId, { type: 'task:created' })
  return { ok: true, taskIds }
}
