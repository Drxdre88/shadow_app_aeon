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

/** Minutes from local midnight at which a working day opens when nothing says otherwise. */
export const DEFAULT_DAY_START_MINUTE = 9 * 60

export interface CalendarException {
  /** Calendar day in the calendar's own timezone, ISO `YYYY-MM-DD`. */
  day: string
  isWorking: boolean
  /** Working hours for a half-day. Null/undefined = the calendar's hoursPerDay. */
  hours?: number | null
  /**
   * Minutes from local midnight at which this one day opens. Null/undefined =
   * the calendar's `dayStartMinute`. Without it `hours` is a duration anchored
   * at the normal start, so a half-day could only ever be a MORNING half-day;
   * an afternoon close (13:00–17:00) is `startMinute: 780, hours: 4`.
   */
  startMinute?: number | null
}

export interface WorkCalendar {
  id: string
  /** IANA zone, e.g. 'Europe/London'. Every boundary is computed here (never the server's zone). */
  timezone: string
  hoursPerDay: number
  /**
   * Minutes from local midnight at which the working day opens, in the calendar's
   * own zone. 540 = 09:00. The day then runs `hoursPerDay` of real time from there,
   * so a late start legitimately spills past local midnight (a night shift).
   */
  dayStartMinute: number
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
  /**
   * The dates a human typed on the card (`board_tasks.start_date` / `end_date`).
   * Inputs, never outputs: a `manual` pin occupies exactly this span, so two pinned
   * cards on one resource no longer both collapse onto `now` and overbook it.
   * Ignored for `auto` work, which the sweep places from `now` (CHR-49).
   */
  plannedStart: Date | null
  plannedEnd: Date | null
  /** Null = unestimated. Scheduled at a default span, excluded from capacity (CHR-11). */
  estimateMinutes: number | null
  /** The card's raw size, in the board's own unit. Input to the estimate conversion. */
  size: number | null
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
  /**
   * The half-open end of `[computedStart, computedEnd)` on the WORKING-time axis:
   * the instant a successor may begin, which after a full day's work is the next
   * morning's open, not last night's close. Chain on this; never draw it. The view
   * draws to `CalendarIndex.toDisplayEnd(computedEnd)`.
   */
  computedEnd: Date
  /**
   * When work really began, echoed from `ScheduleTask.startedAt` (CHR-50). Kept
   * apart from `computedStart`, which for in-progress work is where the REMAINING
   * effort is booked — never earlier than `now` (CHR-49). A renderer draws the
   * actual from here and the plan from `computedStart`.
   */
  actualStart: Date | null
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
  /**
   * A pinned or completed task overlaps other work on its resource. Actuals and
   * pins are facts and must not roll (CHR-50), so the solver places them anyway
   * — but it must never leave the conflict silent, or capacity is under-reported
   * and the bars stack invisibly on the same lane.
   */
  | 'resource-overbooked'

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
 *
 * Every interval this index describes is half-open, `[start, end)`. That is why
 * there are two ends and they are not the same instant: the solver chains on
 * `computedEnd` (always a working instant, so a successor can start there) and the
 * view draws to `toDisplayEnd(computedEnd)` (the close of the last worked day).
 */
export interface CalendarIndex {
  readonly calendarId: string
  readonly timezone: string
  readonly hoursPerDay: number
  /**
   * The calendar's default day-open, minutes from local midnight (540 = 09:00).
   * Renderers read the start hour from here; it is data, never a module constant.
   * Individual days may open elsewhere via `CalendarException.startMinute`.
   */
  readonly dayStartMinute: number
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
  /**
   * The last working instant at or before `instant` — the honest right edge of a bar.
   *
   * `addDuration(Mon 09:00, 480)` is Tue 09:00, not Mon 17:00, because the working
   * axis has no room between them and a successor must be able to start there.
   * Drawn literally that spills every one-day bar into the next day; `toDisplayEnd`
   * pulls it back to Mon 17:00. Idempotent on a day's close, identity mid-day.
   *
   * It takes only an end, so it cannot know the span's own start: a ZERO-LENGTH
   * span (a milestone, or `computedStart === computedEnd`) resolves to the PREVIOUS
   * day's close. Renderers draw `[computedStart, max(computedStart, toDisplayEnd(computedEnd)))`.
   */
  toDisplayEnd(instant: Date): Date
}

/** Window a solve must cover. Derived, never stored (CHR-54). */
export interface SolveWindow {
  start: Date
  end: Date
}

export interface SizingModel {
  unit: 'days' | 'points'
  hoursPerPoint: number
}

/** Lane C owns the implementation; the solver calls it, never `size` directly (CHR-13). */
export type EstimateResolver = (
  task: Pick<ScheduleTask, 'estimateMinutes' | 'size'>,
  sizing: SizingModel,
  calendar: Pick<WorkCalendar, 'hoursPerDay'>,
) => number | null

/** Span given to an unestimated task so it still renders (CHR-11). */
export const UNESTIMATED_DEFAULT_MINUTES = 8 * 60
