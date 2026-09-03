'use server'

import { requireMemberAccess } from './helpers'
import {
  ensureDefaultCalendar,
  ensureResourcesForPeople,
  findCalendars,
  findDefaultCalendar,
  findResources,
  findScheduleInputs,
  findSchedulePeople,
  persistPlacements,
} from '@/lib/data/schedule'
import { buildCalendarIndex } from '@/lib/schedule/calendar'
import { solve } from '@/lib/schedule/solver'
import {
  groupAssignments,
  sizingFromSettings,
  solveWindowFor,
  toScheduleDependencies,
  toScheduleTasks,
  type AdapterContext,
} from '@/lib/schedule/adapter'
import {
  activeResources,
  DEFAULT_CALENDAR,
  hoursPerDayByResource,
  indexResourcesByPerson,
  planMissingResources,
  toScheduleResource,
  toWorkCalendar,
  unsavedResourceRows,
  type ResourceRow,
  type SchedulePerson,
  type WorkCalendarRow,
} from '@/lib/schedule/resources'
import type { Placement, ScheduleResource, SolveWarning, WorkCalendar } from '@/lib/schedule/types'

export interface ScheduleLane extends ScheduleResource {
  userId: string | null
  virtualMemberId: string | null
  label: string | null
}

export interface ProjectSchedule {
  placements: Placement[]
  warnings: SolveWarning[]
  projectEnd: Date | null
  lanes: ScheduleLane[]
  calendars: WorkCalendar[]
  defaultCalendarId: string
  /** The anchor the solve ran from (CHR-48). */
  now: Date
}

function toLane(row: ResourceRow): ScheduleLane {
  return { ...toScheduleResource(row), userId: row.userId, virtualMemberId: row.virtualMemberId, label: row.label }
}

const UNSAVED_DEFAULT_CALENDAR: WorkCalendarRow = {
  id: 'unsaved:default',
  timezone: DEFAULT_CALENDAR.timezone,
  hoursPerDay: DEFAULT_CALENDAR.hoursPerDay,
  dayStartMinute: DEFAULT_CALENDAR.dayStartMinute,
  workweek: DEFAULT_CALENDAR.workweek,
}

/** A viewer's lanes: the stored rows plus in-memory stand-ins for anyone still missing one. */
async function readOnlyResources(projectId: string, people: SchedulePerson[]): Promise<ResourceRow[]> {
  const existing = await findResources(projectId)
  return [...existing, ...unsavedResourceRows(planMissingResources(projectId, people, existing))]
}

/**
 * Solve-on-read (CHR-52). Called when a scheduler view opens, never on board
 * load: it derives lanes from the project's people, guarantees a calendar, runs
 * the solver from `now`, persists computed_* as the cache and returns the plan.
 * Any member may read the schedule. The derived rows — the default calendar,
 * one resource per person, the computed_* cache — are written only for editors;
 * a viewer gets the same plan solved in memory over unsaved stand-ins.
 */
export async function solveProject(projectId: string): Promise<ProjectSchedule> {
  const { role } = await requireMemberAccess(projectId)
  const canWrite = role !== 'viewer'
  const now = new Date()

  const defaultCalendar = canWrite
    ? await ensureDefaultCalendar(projectId)
    : (await findDefaultCalendar(projectId)) ?? UNSAVED_DEFAULT_CALENDAR
  const people = await findSchedulePeople(projectId)
  const resourceRows = canWrite
    ? await ensureResourcesForPeople(projectId, people)
    : await readOnlyResources(projectId, people)
  const [{ calendars: calendarRows, exceptions }, inputs] = await Promise.all([
    findCalendars(projectId),
    findScheduleInputs(projectId),
  ])

  const calendars = calendarRows.map((row) => toWorkCalendar(row, exceptions))
  if (!calendars.some((c) => c.id === defaultCalendar.id)) calendars.push(toWorkCalendar(defaultCalendar, exceptions))
  const active = activeResources(resourceRows, people)
  const lanes = active.map(toLane)
  const { byUserId, byVirtualMemberId } = indexResourcesByPerson(active)
  const hoursByResource = hoursPerDayByResource(lanes, calendars, defaultCalendar.id)
  const defaultHoursPerDay = calendars.find((c) => c.id === defaultCalendar.id)?.hoursPerDay ?? 8

  const ctx: AdapterContext = {
    sizing: sizingFromSettings(inputs.settings),
    columnOrder: new Map(inputs.columns.map((c) => [c.id, c.orderIndex])),
    assignments: groupAssignments(inputs.assignments),
    resourceIdByUserId: byUserId,
    resourceIdByVirtualMemberId: byVirtualMemberId,
    hoursPerDayByResourceId: hoursByResource,
    defaultHoursPerDay,
  }
  const tasks = toScheduleTasks(inputs.tasks, ctx)
  const window = solveWindowFor(tasks, now)
  const result = solve(
    {
      tasks,
      dependencies: toScheduleDependencies(inputs.dependencies),
      resources: lanes,
      calendars,
      now,
      defaultCalendarId: defaultCalendar.id,
    },
    (calendar) => buildCalendarIndex(calendar, window),
  )

  if (canWrite) await persistPlacements(projectId, result.placements)

  return {
    placements: result.placements,
    warnings: result.warnings,
    projectEnd: result.projectEnd,
    lanes,
    calendars,
    defaultCalendarId: defaultCalendar.id,
    now,
  }
}
