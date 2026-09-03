/**
 * Canonical Chronos scenarios. READ-ONLY for the lanes — both the solver suite and
 * the calendar suite build on these so their expectations cannot drift apart.
 * Add new fixtures; never edit an existing one's shape.
 */
import {
  DEFAULT_DAY_START_MINUTE,
  WORKWEEK_MON_FRI,
  type ScheduleTask,
  type ScheduleResource,
  type WorkCalendar,
  type ScheduleDependency,
} from './types'

export const LONDON_MON_FRI: WorkCalendar = {
  id: 'cal-london',
  timezone: 'Europe/London',
  hoursPerDay: 8,
  dayStartMinute: DEFAULT_DAY_START_MINUTE,
  workweek: WORKWEEK_MON_FRI,
  exceptions: [],
}

/** Same calendar with an August bank holiday and a half-day before it. */
export const LONDON_WITH_HOLIDAY: WorkCalendar = {
  ...LONDON_MON_FRI,
  id: 'cal-london-holiday',
  exceptions: [
    { day: '2026-08-31', isWorking: false },
    { day: '2026-08-28', isWorking: true, hours: 4 },
  ],
}

/** A viewer well west of UTC — pins the timezone-boundary rule. */
export const DENVER_MON_FRI: WorkCalendar = {
  id: 'cal-denver',
  timezone: 'America/Denver',
  hoursPerDay: 8,
  dayStartMinute: DEFAULT_DAY_START_MINUTE,
  workweek: WORKWEEK_MON_FRI,
  exceptions: [],
}

/** Opens at 07:00 local — proves the day-open is data, not a module constant. */
export const LONDON_EARLY_START: WorkCalendar = {
  ...LONDON_MON_FRI,
  id: 'cal-london-early',
  dayStartMinute: 7 * 60,
}

/** 22:00 local, seven days a week — the working day deliberately crosses local midnight. */
export const LONDON_NIGHT_SHIFT: WorkCalendar = {
  ...LONDON_MON_FRI,
  id: 'cal-london-night',
  dayStartMinute: 22 * 60,
  workweek: 127,
}

/** The same night shift a continent west, so DST lands on a different date. */
export const DENVER_NIGHT_SHIFT: WorkCalendar = {
  ...DENVER_MON_FRI,
  id: 'cal-denver-night',
  dayStartMinute: 22 * 60,
  workweek: 127,
}

/**
 * We close the morning and work 13:00–17:00 on the Friday. Inexpressible before
 * `CalendarException.startMinute`: `hours` alone can only shorten from the open.
 */
export const LONDON_AFTERNOON_HALF_DAY: WorkCalendar = {
  ...LONDON_MON_FRI,
  id: 'cal-london-pm-half',
  exceptions: [{ day: '2026-09-04', isWorking: true, hours: 4, startMinute: 13 * 60 }],
}

export const RESOURCE_SOLO: ScheduleResource = {
  id: 'res-a',
  kind: 'user',
  calendarId: LONDON_MON_FRI.id,
  concurrency: 1,
  focusFactor: 1,
  orderIndex: 0,
  parentResourceId: null,
}

/** An AI delegate lane hanging off res-a — three parallel slots. */
export const RESOURCE_AGENT: ScheduleResource = {
  id: 'res-a-claude',
  kind: 'agent',
  calendarId: LONDON_MON_FRI.id,
  concurrency: 3,
  focusFactor: 1,
  orderIndex: 1,
  parentResourceId: RESOURCE_SOLO.id,
}

export const RESOURCE_HALF_TIME: ScheduleResource = {
  ...RESOURCE_SOLO,
  id: 'res-b',
  focusFactor: 0.5,
  orderIndex: 2,
}

/** Monday 2026-09-07, 09:00 Europe/London. The anchor for every fixture below. */
export const NOW = new Date('2026-09-07T08:00:00.000Z')

export function task(id: string, over: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    status: 'todo',
    scheduleMode: 'auto',
    constraintType: 'asap',
    constraintDate: null,
    plannedStart: null,
    plannedEnd: null,
    estimateMinutes: 8 * 60,
    size: null,
    progress: null,
    ownerResourceId: RESOURCE_SOLO.id,
    startedAt: null,
    completedAt: null,
    isMilestone: false,
    columnOrder: 0,
    orderIndex: 0,
    priority: 0,
    ...over,
  }
}

export function dep(
  blockerTaskId: string,
  blockedTaskId: string,
  lagMinutes = 0,
): ScheduleDependency {
  return { blockerTaskId, blockedTaskId, type: 'fs', lagMinutes }
}

/** A → B → C, one day each, all on the same single-lane resource. */
export const CHAIN_OF_THREE = {
  tasks: [
    task('a', { orderIndex: 0 }),
    task('b', { orderIndex: 1 }),
    task('c', { orderIndex: 2 }),
  ],
  dependencies: [dep('a', 'b'), dep('b', 'c')],
}

/** A ↔ B mutual block — must drop edges and still return a plan (CHR-17). */
export const CYCLE_OF_TWO = {
  tasks: [task('a', { orderIndex: 0 }), task('b', { orderIndex: 1 })],
  dependencies: [dep('a', 'b'), dep('b', 'a')],
}

/** Half-done in-progress work — schedules remaining effort only (CHR-51). */
export const IN_PROGRESS_HALF = {
  tasks: [
    task('a', {
      status: 'in-progress',
      progress: 50,
      estimateMinutes: 5 * 8 * 60,
      startedAt: new Date('2026-09-03T08:00:00.000Z'),
    }),
  ],
  dependencies: [] as ScheduleDependency[],
}

/** A stale todo whose dates sat in the past — must re-project to now (CHR-49). */
export const STALE_TODO = {
  tasks: [
    task('a', {
      constraintType: 'snet',
      constraintDate: new Date('2026-08-10T08:00:00.000Z'),
    }),
  ],
  dependencies: [] as ScheduleDependency[],
}
