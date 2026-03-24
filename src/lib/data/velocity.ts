import { db } from '@/lib/db'
import { activityEvents, taskVault, boardColumns } from '@/lib/db/schema'
import { eq, and, gte, sql } from 'drizzle-orm'

export type VelocityRange = '7d' | '30d' | '90d' | 'all'

function rangeToDate(range: VelocityRange): Date | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

export async function getCompletionVelocity(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)
  const interval = range === '7d' ? 'day' : range === '30d' ? 'day' : 'week'

  const conditions = [
    eq(activityEvents.projectId, projectId),
    sql`${activityEvents.action} IN ('completed', 'vaulted')`,
  ]
  if (since) {
    conditions.push(gte(activityEvents.createdAt, since))
  }

  const rows = await db
    .select({
      period: sql<string>`date_trunc(${sql.raw(`'${interval}'`)}, ${activityEvents.createdAt})::date::text`,
      count: sql<number>`count(DISTINCT ${activityEvents.entityId})::int`,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .groupBy(sql`date_trunc(${sql.raw(`'${interval}'`)}, ${activityEvents.createdAt})`)
    .orderBy(sql`date_trunc(${sql.raw(`'${interval}'`)}, ${activityEvents.createdAt})`)

  return rows
}

export async function getCycleTimeStats(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [eq(taskVault.projectId, projectId)]
  if (since) {
    conditions.push(sql`coalesce(${taskVault.completedAt}, ${taskVault.archivedAt}) >= ${since}`)
  }

  const [result] = await db
    .select({
      avgDays: sql<number>`avg(${taskVault.daysTaken})`,
      medianDays: sql<number>`percentile_cont(0.5) within group (order by ${taskVault.daysTaken})`,
      p95Days: sql<number>`percentile_cont(0.95) within group (order by ${taskVault.daysTaken})`,
      totalCompleted: sql<number>`count(*)::int`,
    })
    .from(taskVault)
    .where(and(...conditions, sql`${taskVault.daysTaken} IS NOT NULL`))

  return {
    avgDays: result?.avgDays ? Math.round(result.avgDays * 10) / 10 : null,
    medianDays: result?.medianDays ? Math.round(result.medianDays * 10) / 10 : null,
    p95Days: result?.p95Days ? Math.round(result.p95Days * 10) / 10 : null,
    totalCompleted: result?.totalCompleted ?? 0,
  }
}

export async function getColumnDwellTimes(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [
    eq(activityEvents.projectId, projectId),
    eq(activityEvents.action, 'moved'),
  ]
  if (since) {
    conditions.push(gte(activityEvents.createdAt, since))
  }

  const movedEvents = await db
    .select({
      entityId: activityEvents.entityId,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(activityEvents.entityId, activityEvents.createdAt)

  const columns = await db
    .select({ id: boardColumns.id, name: boardColumns.name })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))

  const columnNameMap = new Map(columns.map(c => [c.id, c.name]))
  const dwellAccum = new Map<string, number[]>()

  let prevEvent: { entityId: string; toColumnId: string; time: Date } | null = null

  for (const ev of movedEvents) {
    const meta = ev.metadata as Record<string, unknown>
    const toCol = meta?.toColumnId as string | undefined
    const fromCol = meta?.fromColumnId as string | undefined

    if (prevEvent && prevEvent.entityId === ev.entityId && fromCol) {
      const dwellMs = new Date(ev.createdAt).getTime() - prevEvent.time.getTime()
      const dwellHours = dwellMs / (1000 * 60 * 60)
      const colName = columnNameMap.get(fromCol) ?? fromCol
      if (!dwellAccum.has(colName)) dwellAccum.set(colName, [])
      dwellAccum.get(colName)!.push(dwellHours)
    }

    prevEvent = toCol
      ? { entityId: ev.entityId, toColumnId: toCol, time: new Date(ev.createdAt) }
      : null
  }

  return Array.from(dwellAccum.entries()).map(([column, hours]) => ({
    column,
    avgHours: Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10,
    count: hours.length,
  }))
}

export async function getActivityHeatmap(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [
    eq(activityEvents.projectId, projectId),
    sql`${activityEvents.action} IN ('completed', 'vaulted')`,
  ]
  if (since) {
    conditions.push(gte(activityEvents.createdAt, since))
  }

  const rows = await db
    .select({
      dayOfWeek: sql<number>`extract(dow from ${activityEvents.createdAt})::int`,
      hourOfDay: sql<number>`extract(hour from ${activityEvents.createdAt})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .groupBy(
      sql`extract(dow from ${activityEvents.createdAt})`,
      sql`extract(hour from ${activityEvents.createdAt})`
    )

  return rows
}

export async function getPriorityBreakdown(projectId: string, range: VelocityRange) {
  const since = rangeToDate(range)

  const conditions = [eq(taskVault.projectId, projectId)]
  if (since) {
    conditions.push(sql`coalesce(${taskVault.completedAt}, ${taskVault.archivedAt}) >= ${since}`)
  }

  const rows = await db
    .select({
      priority: taskVault.priority,
      count: sql<number>`count(*)::int`,
      avgDays: sql<number>`avg(${taskVault.daysTaken})`,
    })
    .from(taskVault)
    .where(and(...conditions))
    .groupBy(taskVault.priority)

  return rows.map(r => ({
    priority: r.priority,
    count: r.count,
    avgDays: r.avgDays ? Math.round(r.avgDays * 10) / 10 : null,
  }))
}

export async function getVelocityStats(projectId: string, range: VelocityRange = '30d') {
  const [velocity, cycleTime, dwellTimes, heatmap, priorities] = await Promise.all([
    getCompletionVelocity(projectId, range),
    getCycleTimeStats(projectId, range),
    getColumnDwellTimes(projectId, range),
    getActivityHeatmap(projectId, range),
    getPriorityBreakdown(projectId, range),
  ])

  return { velocity, cycleTime, dwellTimes, heatmap, priorities, range }
}
