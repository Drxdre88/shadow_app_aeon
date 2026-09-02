import { db } from '@/lib/db'
import {
  boardColumns,
  boardTasks,
  calendarExceptions,
  projects,
  resources,
  taskAssignees,
  taskDependencies,
  taskVirtualAssignees,
  workCalendars,
} from '@/lib/db/schema'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { findAssignableMembers } from './members'
import { findVirtualMembersForProject } from './virtual-members'
import { findProjectSettings } from './projects'
import {
  DEFAULT_CALENDAR,
  planMissingResources,
  type CalendarExceptionRow,
  type ResourceRow,
  type SchedulePerson,
  type WorkCalendarRow,
} from '@/lib/schedule/resources'
import type { AssignmentRow, DependencyRow, ScheduleTaskRow } from '@/lib/schedule/adapter'
import type { Placement } from '@/lib/schedule/types'

// CHRONOS data layer. Pure Drizzle: the shapes returned here are the structural
// row types lib/schedule/adapter.ts and lib/schedule/resources.ts consume, so
// the engine never imports the db.

const resourceColumns = {
  id: resources.id,
  kind: resources.kind,
  userId: resources.userId,
  virtualMemberId: resources.virtualMemberId,
  parentResourceId: resources.parentResourceId,
  calendarId: resources.calendarId,
  label: resources.label,
  concurrency: resources.concurrency,
  focusFactor: resources.focusFactor,
  orderIndex: resources.orderIndex,
}

const calendarColumns = {
  id: workCalendars.id,
  timezone: workCalendars.timezone,
  hoursPerDay: workCalendars.hoursPerDay,
  dayStartMinute: workCalendars.dayStartMinute,
  workweek: workCalendars.workweek,
}

/** Everyone a card can be assigned to on this project, as scheduling people. */
export async function findSchedulePeople(projectId: string): Promise<SchedulePerson[]> {
  const [members, virtuals] = await Promise.all([
    findAssignableMembers(projectId),
    findVirtualMembersForProject(projectId),
  ])
  return [
    ...members.map((m): SchedulePerson => ({ kind: 'user', userId: m.userId, label: m.name ?? m.email })),
    ...virtuals.map((v): SchedulePerson => ({ kind: 'virtual', virtualMemberId: v.id, label: v.name })),
  ]
}

export async function findResources(projectId: string): Promise<ResourceRow[]> {
  return db
    .select(resourceColumns)
    .from(resources)
    .where(eq(resources.projectId, projectId))
    .orderBy(asc(resources.orderIndex), asc(resources.createdAt))
}

/**
 * One resource per person, created on first sight and never duplicated: the
 * plan skips people who already have a row, and the insert is ON CONFLICT DO
 * NOTHING against the partial unique indexes so two concurrent solves cannot
 * race a second row in. Returns the full list afterwards.
 */
export async function ensureResourcesForPeople(projectId: string, people: SchedulePerson[]): Promise<ResourceRow[]> {
  const existing = await findResources(projectId)
  const missing = planMissingResources(projectId, people, existing)
  if (missing.length === 0) return existing
  await db.insert(resources).values(missing).onConflictDoNothing()
  return findResources(projectId)
}

export async function findCalendars(projectId: string): Promise<{ calendars: WorkCalendarRow[]; exceptions: CalendarExceptionRow[] }> {
  const calendars = await db
    .select(calendarColumns)
    .from(workCalendars)
    .where(eq(workCalendars.projectId, projectId))
    .orderBy(asc(workCalendars.createdAt))
  if (calendars.length === 0) return { calendars, exceptions: [] }
  const exceptions = await db
    .select({
      calendarId: calendarExceptions.calendarId,
      day: calendarExceptions.day,
      isWorking: calendarExceptions.isWorking,
      hours: calendarExceptions.hours,
      startMinute: calendarExceptions.startMinute,
    })
    .from(calendarExceptions)
    .innerJoin(workCalendars, eq(workCalendars.id, calendarExceptions.calendarId))
    .where(eq(workCalendars.projectId, projectId))
  return { calendars, exceptions }
}

async function findOldestCalendar(conn: Pick<typeof db, 'select'>, projectId: string): Promise<WorkCalendarRow | undefined> {
  const [row] = await conn
    .select(calendarColumns)
    .from(workCalendars)
    .where(eq(workCalendars.projectId, projectId))
    .orderBy(asc(workCalendars.createdAt))
    .limit(1)
  return row
}

/** The project's oldest calendar, or none: the read-only half of ensureDefaultCalendar. */
export async function findDefaultCalendar(projectId: string): Promise<WorkCalendarRow | null> {
  return (await findOldestCalendar(db, projectId)) ?? null
}

/**
 * The project's oldest calendar, creating the default Mon–Fri 09:00–17:00 UTC
 * one when there is none. The common case is a plain read; only a project with
 * no calendar yet enters the transaction, where the project row is locked and
 * the check repeated so two first solves cannot each create one.
 */
export async function ensureDefaultCalendar(projectId: string): Promise<WorkCalendarRow> {
  const existing = await findOldestCalendar(db, projectId)
  if (existing) return existing
  return db.transaction(async (tx) => {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update')
    const locked = await findOldestCalendar(tx, projectId)
    if (locked) return locked
    const [created] = await tx
      .insert(workCalendars)
      .values({
        projectId,
        name: DEFAULT_CALENDAR.name,
        timezone: DEFAULT_CALENDAR.timezone,
        hoursPerDay: String(DEFAULT_CALENDAR.hoursPerDay),
        dayStartMinute: DEFAULT_CALENDAR.dayStartMinute,
        workweek: DEFAULT_CALENDAR.workweek,
      })
      .returning(calendarColumns)
    return created
  })
}

export interface ScheduleInputRows {
  settings: Record<string, unknown> | null
  tasks: ScheduleTaskRow[]
  columns: { id: string; orderIndex: number }[]
  assignments: AssignmentRow[]
  dependencies: DependencyRow[]
}

/** Every live (unarchived) card with what the solver needs, in one round of parallel reads. */
export async function findScheduleInputs(projectId: string): Promise<ScheduleInputRows> {
  const [settings, tasks, columns, real, virtual, dependencies] = await Promise.all([
    findProjectSettings(projectId),
    db
      .select({
        id: boardTasks.id,
        status: boardTasks.status,
        priority: boardTasks.priority,
        columnId: boardTasks.columnId,
        startDate: boardTasks.startDate,
        endDate: boardTasks.endDate,
        size: boardTasks.size,
        progress: boardTasks.progress,
        orderIndex: boardTasks.orderIndex,
        completedAt: boardTasks.completedAt,
        estimateMinutes: boardTasks.estimateMinutes,
        scheduleMode: boardTasks.scheduleMode,
        constraintType: boardTasks.constraintType,
        constraintDate: boardTasks.constraintDate,
        isMilestone: boardTasks.isMilestone,
        ownerResourceId: boardTasks.ownerResourceId,
        startedAt: boardTasks.startedAt,
      })
      .from(boardTasks)
      .where(and(eq(boardTasks.projectId, projectId), isNull(boardTasks.archivedAt)))
      .orderBy(asc(boardTasks.orderIndex)),
    db
      .select({ id: boardColumns.id, orderIndex: boardColumns.orderIndex })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId)),
    db
      .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, assignedAt: taskAssignees.assignedAt })
      .from(taskAssignees)
      .innerJoin(boardTasks, eq(boardTasks.id, taskAssignees.taskId))
      .where(eq(boardTasks.projectId, projectId)),
    db
      .select({
        taskId: taskVirtualAssignees.taskId,
        virtualMemberId: taskVirtualAssignees.virtualMemberId,
        assignedAt: taskVirtualAssignees.assignedAt,
      })
      .from(taskVirtualAssignees)
      .innerJoin(boardTasks, eq(boardTasks.id, taskVirtualAssignees.taskId))
      .where(eq(boardTasks.projectId, projectId)),
    db
      .select({ blockerTaskId: taskDependencies.blockerTaskId, blockedTaskId: taskDependencies.blockedTaskId })
      .from(taskDependencies)
      .innerJoin(boardTasks, eq(boardTasks.id, taskDependencies.blockerTaskId))
      .where(eq(boardTasks.projectId, projectId)),
  ])
  return { settings, tasks, columns, assignments: [...real, ...virtual], dependencies }
}

export const PERSIST_CHUNK = 500

function compareTaskId(a: Placement, b: Placement): number {
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0
}

/**
 * Writes the solver's output back as the persisted cache (CHR-52): one UPDATE
 * per chunk from a VALUES list, all inside one transaction, so a reader never
 * sees half a schedule. Instants go over as UTC ISO text with an explicit cast —
 * the columns are naive timestamps and a Date parameter would be serialised in
 * the server's zone. Deliberately no touchProject: this is a read-side cache,
 * not a user edit, and bumping boardVersion would make every open board reload.
 *
 * Two solves of one project serialise on a transaction-scoped advisory lock,
 * and rows are written in taskId order, so concurrent writers cannot deadlock
 * on row locks taken in different orders. Cards that fell out of the solve
 * (archived, or otherwise absent) have their cache cleared in the same
 * transaction, so unarchiving never resurrects a stale span.
 */
export async function persistPlacements(projectId: string, placements: readonly Placement[]): Promise<number> {
  const ordered = [...placements].sort(compareTaskId)
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`)
    const placedIds = sql.join(ordered.map((p) => sql`${p.taskId}::uuid`), sql`, `)
    await tx.execute(sql`
      update board_tasks
      set computed_start = null, computed_end = null, total_float_min = null
      where project_id = ${projectId}
        and computed_start is not null
        and id <> all(array[${placedIds}]::uuid[])
    `)
    for (let i = 0; i < ordered.length; i += PERSIST_CHUNK) {
      const chunk = ordered.slice(i, i + PERSIST_CHUNK)
      const values = sql.join(
        chunk.map(
          (p) =>
            sql`(${p.taskId}::uuid, ${p.computedStart.toISOString()}::timestamp, ${p.computedEnd.toISOString()}::timestamp, ${p.totalFloatMin}::integer)`,
        ),
        sql`, `,
      )
      await tx.execute(sql`
        update board_tasks as t
        set computed_start = v.computed_start,
            computed_end = v.computed_end,
            total_float_min = v.total_float_min
        from (values ${values}) as v(id, computed_start, computed_end, total_float_min)
        where t.id = v.id and t.project_id = ${projectId}
      `)
    }
  })
  return ordered.length
}
