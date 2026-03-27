import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { projects, boardTasks, checklistItems, canvasNodes, ganttTasks, activityEvents, users } from '@/lib/db/schema'
import { eq, count, inArray } from 'drizzle-orm'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'

async function handler() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId))

  const projectIds = userProjects.map((p) => p.id)

  const [userRow] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))

  if (projectIds.length === 0) {
    return NextResponse.json({
      projects: 0,
      tasks: 0,
      checklistItems: 0,
      canvasNodes: 0,
      ganttTasks: 0,
      activityEvents: 0,
      memberSince: userRow?.createdAt ?? null,
    })
  }

  const taskRows = await db
    .select({ id: boardTasks.id })
    .from(boardTasks)
    .where(inArray(boardTasks.projectId, projectIds))

  const taskIds = taskRows.map((t) => t.id)

  const [[checklistCount], [canvasCount], [ganttCount], [activityCount]] = await Promise.all([
    taskIds.length > 0
      ? db.select({ value: count() }).from(checklistItems).where(inArray(checklistItems.taskId, taskIds))
      : Promise.resolve([{ value: 0 }]),
    db.select({ value: count() }).from(canvasNodes).where(inArray(canvasNodes.projectId, projectIds)),
    db.select({ value: count() }).from(ganttTasks).where(inArray(ganttTasks.projectId, projectIds)),
    db.select({ value: count() }).from(activityEvents).where(inArray(activityEvents.projectId, projectIds)),
  ])

  return NextResponse.json({
    projects: projectIds.length,
    tasks: taskRows.length,
    checklistItems: checklistCount.value,
    canvasNodes: canvasCount.value,
    ganttTasks: ganttCount.value,
    activityEvents: activityCount.value,
    memberSince: userRow?.createdAt ?? null,
  })
}

export const GET = withRateLimit(handler as (req: NextRequest, ctx: unknown) => Promise<NextResponse>, API_READ_LIMIT)
