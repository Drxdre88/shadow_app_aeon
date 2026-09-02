/**
 * Chronos resource derivation. Lanes are PEOPLE: a resource is a scheduling
 * satellite over the existing people model (project members, virtual members),
 * never a second identity. This file plans which `resources` rows are missing
 * for a project's people and maps stored rows into engine shapes. Pure — the
 * data layer does the inserting.
 */
import { WORKWEEK_MON_FRI, DEFAULT_DAY_START_MINUTE, type CalendarException, type ScheduleResource, type WorkCalendar } from './types'

export type SchedulePerson =
  | { kind: 'user'; userId: string; label: string | null }
  | { kind: 'virtual'; virtualMemberId: string; label: string | null }

/** A `resources` row as the data layer returns it; numeric columns arrive as strings. */
export interface ResourceRow {
  id: string
  kind: string
  userId: string | null
  virtualMemberId: string | null
  parentResourceId: string | null
  calendarId: string | null
  label: string | null
  concurrency: number
  focusFactor: string | number
  orderIndex: number
}

export interface NewResourceRow {
  projectId: string
  kind: 'user' | 'virtual'
  userId: string | null
  virtualMemberId: string | null
  label: string | null
  orderIndex: number
}

export interface WorkCalendarRow {
  id: string
  timezone: string
  hoursPerDay: string | number
  dayStartMinute: number
  workweek: number
}

export interface CalendarExceptionRow {
  calendarId: string
  day: string
  isWorking: boolean
  hours: string | number | null
  startMinute: number | null
}

/**
 * The calendar a project gets when it has none. UTC rather than the column's
 * 'Europe/London' default: nothing on a user or realm records a zone yet, and a
 * guessed zone is worse than an honest neutral one the owner can change.
 */
export const DEFAULT_CALENDAR = {
  name: 'Default',
  timezone: 'UTC',
  hoursPerDay: 8,
  dayStartMinute: DEFAULT_DAY_START_MINUTE,
  workweek: WORKWEEK_MON_FRI,
} as const

function toNumber(value: string | number | null | undefined, fallback: number): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Truncates a person's display name to the `resources.label` column. */
export function resourceLabel(label: string | null | undefined): string | null {
  const trimmed = label?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed.slice(0, 120)
}

/**
 * The rows to insert so every person has exactly one resource. Idempotent by
 * construction: a person who already has a row (matched on the identity column
 * the unique indexes key on) is skipped, so planning against the result of a
 * previous plan yields nothing. Order indexes continue after the existing ones,
 * in the order the people were given.
 */
export function planMissingResources(
  projectId: string,
  people: readonly SchedulePerson[],
  existing: readonly ResourceRow[],
): NewResourceRow[] {
  const haveUser = new Set(existing.map((r) => r.userId).filter((id): id is string => !!id))
  const haveVirtual = new Set(existing.map((r) => r.virtualMemberId).filter((id): id is string => !!id))
  let orderIndex = existing.reduce((max, r) => Math.max(max, r.orderIndex), -1) + 1
  const out: NewResourceRow[] = []
  for (const person of people) {
    if (person.kind === 'user') {
      if (haveUser.has(person.userId)) continue
      haveUser.add(person.userId)
      out.push({ projectId, kind: 'user', userId: person.userId, virtualMemberId: null, label: resourceLabel(person.label), orderIndex: orderIndex++ })
    } else {
      if (haveVirtual.has(person.virtualMemberId)) continue
      haveVirtual.add(person.virtualMemberId)
      out.push({ projectId, kind: 'virtual', userId: null, virtualMemberId: person.virtualMemberId, label: resourceLabel(person.label), orderIndex: orderIndex++ })
    }
  }
  return out
}

export function toScheduleResource(row: ResourceRow): ScheduleResource {
  const kind = row.kind === 'virtual' || row.kind === 'agent' ? row.kind : 'user'
  const concurrency = Number.isFinite(row.concurrency) && row.concurrency >= 1 ? Math.floor(row.concurrency) : 1
  const focus = toNumber(row.focusFactor, 1)
  return {
    id: row.id,
    kind,
    calendarId: row.calendarId,
    concurrency,
    focusFactor: focus > 0 && focus <= 1 ? focus : 1,
    orderIndex: row.orderIndex,
    parentResourceId: row.parentResourceId,
  }
}

export function indexResourcesByPerson(rows: readonly ResourceRow[]): {
  byUserId: Map<string, string>
  byVirtualMemberId: Map<string, string>
} {
  const byUserId = new Map<string, string>()
  const byVirtualMemberId = new Map<string, string>()
  for (const row of rows) {
    if (row.userId && !byUserId.has(row.userId)) byUserId.set(row.userId, row.id)
    if (row.virtualMemberId && !byVirtualMemberId.has(row.virtualMemberId)) byVirtualMemberId.set(row.virtualMemberId, row.id)
  }
  return { byUserId, byVirtualMemberId }
}

export function toWorkCalendar(row: WorkCalendarRow, exceptions: readonly CalendarExceptionRow[]): WorkCalendar {
  const own: CalendarException[] = exceptions
    .filter((e) => e.calendarId === row.id)
    .map((e) => ({
      day: e.day,
      isWorking: e.isWorking,
      hours: e.hours == null ? null : toNumber(e.hours, 0),
      startMinute: e.startMinute,
    }))
  return {
    id: row.id,
    timezone: row.timezone,
    hoursPerDay: toNumber(row.hoursPerDay, DEFAULT_CALENDAR.hoursPerDay),
    dayStartMinute: row.dayStartMinute,
    workweek: row.workweek,
    exceptions: own,
  }
}

/** resourceId → hoursPerDay of its calendar, falling back to the default calendar's. */
export function hoursPerDayByResource(
  resources: readonly ScheduleResource[],
  calendars: readonly WorkCalendar[],
  defaultCalendarId: string,
): Map<string, number> {
  const hours = new Map(calendars.map((c) => [c.id, c.hoursPerDay]))
  const fallback = hours.get(defaultCalendarId) ?? DEFAULT_CALENDAR.hoursPerDay
  return new Map(resources.map((r) => [r.id, (r.calendarId ? hours.get(r.calendarId) : undefined) ?? fallback]))
}
