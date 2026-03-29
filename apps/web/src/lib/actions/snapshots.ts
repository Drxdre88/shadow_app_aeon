'use server'

import { randomBytes } from 'crypto'
import { requireEditor } from './helpers'
import { db } from '@/lib/db'
import { boardSnapshots, projects, boardColumns, boardTasks, labels, taskLabels } from '@/lib/db/schema'
import { eq, inArray, and, gt } from 'drizzle-orm'

const SNAPSHOT_EXPIRY_DAYS = 7
const MAX_SNAPSHOTS_PER_PROJECT = 5

export async function createBoardSnapshot(projectId: string) {
  const userId = await requireEditor(projectId)

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) throw new Error('Project not found')

  const [columns, tasks, projectLabels] = await Promise.all([
    db.select().from(boardColumns).where(eq(boardColumns.projectId, projectId)),
    db.select().from(boardTasks).where(eq(boardTasks.projectId, projectId)),
    db.select().from(labels).where(eq(labels.projectId, projectId)),
  ])

  const taskIds = tasks.map((t) => t.id)
  const taskLabelRows = taskIds.length > 0
    ? await db.select().from(taskLabels).where(inArray(taskLabels.taskId, taskIds))
    : []

  const snapshot = {
    columns: columns.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, orderIndex: c.orderIndex })),
    tasks: tasks.map((t) => ({
      id: t.id, name: t.name, description: t.description, columnId: t.columnId,
      status: t.status, priority: t.priority, color: t.color, orderIndex: t.orderIndex,
      labels: taskLabelRows.filter((tl) => tl.taskId === t.id).map((tl) => tl.labelId),
    })),
    labels: projectLabels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    createdAt: new Date().toISOString(),
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SNAPSHOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  const existing = await db.select({ id: boardSnapshots.id })
    .from(boardSnapshots)
    .where(eq(boardSnapshots.projectId, projectId))
    .orderBy(boardSnapshots.createdAt)

  if (existing.length >= MAX_SNAPSHOTS_PER_PROJECT) {
    const toDelete = existing.slice(0, existing.length - MAX_SNAPSHOTS_PER_PROJECT + 1)
    await db.delete(boardSnapshots).where(inArray(boardSnapshots.id, toDelete.map((r) => r.id)))
  }

  const [row] = await db.insert(boardSnapshots).values({
    projectId,
    createdBy: userId,
    token,
    projectName: project.name,
    snapshot,
    expiresAt,
  }).returning()

  return { token: row.token, expiresAt: row.expiresAt }
}

export async function getBoardSnapshot(token: string) {
  const [row] = await db.select()
    .from(boardSnapshots)
    .where(and(eq(boardSnapshots.token, token), gt(boardSnapshots.expiresAt, new Date())))

  if (!row) return null

  return {
    projectName: row.projectName,
    snapshot: row.snapshot as {
      columns: { id: string; name: string; color: string; icon: string | null; orderIndex: number }[]
      tasks: { id: string; name: string; description: string | null; columnId: string | null; status: string; priority: string; color: string; orderIndex: number; labels: string[] }[]
      labels: { id: string; name: string; color: string }[]
      createdAt: string
    },
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }
}
