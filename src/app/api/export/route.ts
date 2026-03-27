import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { projects, boardColumns, boardTasks, checklistItems, labels, taskLabels, canvasNodes, canvasEdges, ganttTasks, rows } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'

async function handler() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  const userProjects = await db
    .select({
      id: projects.id, name: projects.name, description: projects.description,
      group: projects.group, timeScale: projects.timeScale,
      startDate: projects.startDate, endDate: projects.endDate,
      planetImage: projects.planetImage, createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))

  const projectIds = userProjects.map((p) => p.id)
  if (projectIds.length === 0) {
    return new NextResponse(JSON.stringify({
      exportedAt: new Date().toISOString(),
      version: '1.0',
      user: { email: session.user.email, name: session.user.name },
      projects: [],
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="aeon-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  }

  const [allColumns, allTasks, allLabels, allCanvasNodes, allCanvasEdges, allGanttTasks, allRows] = await Promise.all([
    db.select({ id: boardColumns.id, name: boardColumns.name, color: boardColumns.color, icon: boardColumns.icon, orderIndex: boardColumns.orderIndex }).from(boardColumns).where(inArray(boardColumns.projectId, projectIds)),
    db.select({ id: boardTasks.id, projectId: boardTasks.projectId, columnId: boardTasks.columnId, name: boardTasks.name, description: boardTasks.description, status: boardTasks.status, priority: boardTasks.priority, color: boardTasks.color, startDate: boardTasks.startDate, endDate: boardTasks.endDate, size: boardTasks.size, orderIndex: boardTasks.orderIndex, completedAt: boardTasks.completedAt, createdAt: boardTasks.createdAt }).from(boardTasks).where(inArray(boardTasks.projectId, projectIds)),
    db.select({ id: labels.id, projectId: labels.projectId, name: labels.name, color: labels.color }).from(labels).where(inArray(labels.projectId, projectIds)),
    db.select({ id: canvasNodes.id, projectId: canvasNodes.projectId, type: canvasNodes.type, positionX: canvasNodes.positionX, positionY: canvasNodes.positionY, name: canvasNodes.name, description: canvasNodes.description, color: canvasNodes.color }).from(canvasNodes).where(inArray(canvasNodes.projectId, projectIds)),
    db.select({ id: canvasEdges.id, projectId: canvasEdges.projectId, sourceNodeId: canvasEdges.sourceNodeId, targetNodeId: canvasEdges.targetNodeId, label: canvasEdges.label, animated: canvasEdges.animated }).from(canvasEdges).where(inArray(canvasEdges.projectId, projectIds)),
    db.select({ id: ganttTasks.id, projectId: ganttTasks.projectId, name: ganttTasks.name, startDate: ganttTasks.startDate, endDate: ganttTasks.endDate, color: ganttTasks.color, progress: ganttTasks.progress }).from(ganttTasks).where(inArray(ganttTasks.projectId, projectIds)),
    db.select({ id: rows.id, projectId: rows.projectId, name: rows.name, color: rows.color, orderIndex: rows.orderIndex }).from(rows).where(inArray(rows.projectId, projectIds)),
  ])

  const taskIds = allTasks.map((t) => t.id)
  const [allChecklist, allTaskLabels] = taskIds.length > 0
    ? await Promise.all([
        db.select({ id: checklistItems.id, taskId: checklistItems.taskId, title: checklistItems.title, completed: checklistItems.completed, state: checklistItems.state, groupName: checklistItems.groupName, orderIndex: checklistItems.orderIndex }).from(checklistItems).where(inArray(checklistItems.taskId, taskIds)),
        db.select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId }).from(taskLabels).where(inArray(taskLabels.taskId, taskIds)),
      ])
    : [[], []]

  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    user: { email: session.user.email, name: session.user.name },
    projects: userProjects.map((project) => ({
      ...project,
      columns: allColumns.filter((c) => (allTasks.find((t) => t.projectId === project.id && t.columnId === c.id) || allColumns.find((col) => col.id === c.id)) ? true : false).length > 0 ? allColumns : allColumns,
      labels: allLabels.filter((l) => l.projectId === project.id),
      tasks: allTasks
        .filter((t) => t.projectId === project.id)
        .map((task) => ({
          ...task,
          checklist: allChecklist.filter((ci) => ci.taskId === task.id),
          labels: allTaskLabels
            .filter((tl) => tl.taskId === task.id)
            .map((tl) => allLabels.find((l) => l.id === tl.labelId)?.name)
            .filter(Boolean),
        })),
      ganttTasks: allGanttTasks.filter((g) => g.projectId === project.id),
      rows: allRows.filter((r) => r.projectId === project.id),
      canvas: {
        nodes: allCanvasNodes.filter((n) => n.projectId === project.id),
        edges: allCanvasEdges.filter((e) => e.projectId === project.id),
      },
    })),
  }

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="aeon-export-${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}

export const GET = withRateLimit(handler as (req: NextRequest, ctx: unknown) => Promise<NextResponse>, API_READ_LIMIT)
