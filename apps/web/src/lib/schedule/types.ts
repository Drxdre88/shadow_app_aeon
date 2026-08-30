/**
 * Chronos — the frozen contract between the solver, the calendar index and the
 * estimate conversion. Nothing in this directory may import from `@/lib/db`,
 * carry a 'use server' directive, or read the clock (CHR-3).
 *
 * `now` is always a parameter. There is no project start date (CHR-48).
 */

export type ScheduleMode = 'auto' | 'manual'
export type ConstraintType = 'asap' | 'snet' | 'fnlt'
export type TaskStatus = 'todo' | 'in-progress' | 'done'
export type ResourceKind = 'user' | 'virtual' | 'agent'
export type DependencyType = 'fs' | 'ss' | 'ff' | 'sf'

/** Workweek bitmask: bit 0 = Sunday … bit 6 = Saturday. 62 = Mon–Fri. */
export const WORKWEEK_MON_FRI = 62

export interface CalendarException {
  /** Calendar day in the calendar's own timezone, ISO `YYYY-MM-DD`. */
  day: string
  isWorking: boolean
  /** Working hours for a half-day. Null/undefined = the calendar's hoursPerDay. */
  hours?: number | null
}

export interface WorkCalendar {
  id: string
  /** IANA zone, e.g. 'Europe/London'. Every boundary is computed here (never the server's zone). */
  timezone: string
  hoursPerDay: number
  /** @see WORKWEEK_MON_FRI */
  workweek: number
  exceptions: CalendarException[]
}

export interface ScheduleResource {
  id: string
  kind: ResourceKind
  calendarId: string | null
  /** Lanes this resource gets. >1 accepts that many overlapping reservations (CHR-21). */
  concurrency: number
  /** 0.5 = half-time. Divides into duration. */
  focusFactor: number
  orderIndex: number
  parentResourceId: string | null
}

export interface ScheduleTask {
  id: string
  status: TaskStatus
  scheduleMode: ScheduleMode
  constraintType: ConstraintType
  constraintDate: Date | null
  /** Null = unestimated. Scheduled at a default span, excluded from capacity (CHR-11). */
  estimateMinutes: number | null
  /** 0–100, or null. Drives remaining effort for in-progress work (CHR-51). */
  progress: number | null
  ownerResourceId: string | null
  /** Actuals pin and never roll (CHR-50). */
  startedAt: Date | null
  completedAt: Date | null
  isMilestone: boolean
  /** Tie-break inputs for CHR-4 determinism, most significant first. */
  columnOrder: number
  orderIndex: number
  priority: number
}

export interface ScheduleDependency {
  blockerTaskId: string
  blockedTaskId: string
  /** Stored so the model never needs migrating; the solver treats all types as 'fs' (CHR-14). */
  type: DependencyType
  /** Working minutes. Negative = lead (CHR-15). */
  lagMinutes: number
}

export interface SolveInput {
  tasks: ScheduleTask[]
  dependencies: ScheduleDependency[]
  resources: ScheduleResource[]
  calendars: WorkCalendar[]
  /** The one and only anchor (CHR-48). */
  now: Date
  /** Fallback for tasks whose owner has no calendar, and for the project window. */
  defaultCalendarId: string
}

export interface Placement {
  taskId: string
  computedStart: Date
  computedEnd: Date
  /** Minutes of slack. 0 = on the critical path. */
  totalFloatMin: number
  isCritical: boolean
  ownerResourceId: string | null
  /** Sub-lane within the owner's row, 0-based, < resource.concurrency. */
  laneIndex: number
}

export type WarningKind =
  | 'cycle-edge-dropped'
  | 'unestimated'
  | 'no-owner'
  | 'constraint-violated'
  | 'unknown-resource'

export interface SolveWarning {
  kind: WarningKind
  taskIds: string[]
  message: string
}

export interface SolveResult {
  placements: Placement[]
  /** Latest computedEnd across all placements, or null when nothing was scheduled. */
  projectEnd: Date | null
  warnings: SolveWarning[]
}

/**
 * Built once per calendar per solve by `buildCalendarIndex` (lane C), consumed by
 * the solver (lane B). Every method is pure and total — none may throw.
 */
export interface CalendarIndex {
  readonly calendarId: string
  readonly timezone: string
  readonly hoursPerDay: number
  /** Wall-clock instant → position on the working-time axis, in minutes. */
  toWorkMinutes(instant: Date): number
  /** Working-time position → wall-clock instant. Inverse of toWorkMinutes. */
  fromWorkMinutes(workMinutes: number): Date
  /** Calendar-aware addition: skips non-working time. */
  addDuration(start: Date, minutes: number): Date
  /** Working minutes between two instants. Negative when b precedes a. */
  workingMinutesBetween(a: Date, b: Date): number
  /** Returns `instant` if it already falls in working time, else the next working instant. */
  snapToNextWorkingInstant(instant: Date): Date
  /** True when the instant falls inside working time for this calendar. */
  isWorkingInstant(instant: Date): boolean
}

/** Window a solve must cover. Derived, never stored (CHR-54). */
export interface SolveWindow {
  start: Date
  end: Date
}

export interface BoardSizing {
  unit: 'days' | 'points'
  hoursPerPoint: number
}

/** Lane C owns the implementation; the solver calls it, never `size` directly (CHR-13). */
export type EstimateResolver = (
  task: Pick<ScheduleTask, 'estimateMinutes'> & { size: number | null },
  sizing: BoardSizing,
  calendar: Pick<WorkCalendar, 'hoursPerDay'>,
) => number | null

/** Span given to an unestimated task so it still renders (CHR-11). */
export const UNESTIMATED_DEFAULT_MINUTES = 8 * 60
