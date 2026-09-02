/**
 * Chronos solver — serial schedule generation scheme in one topological sweep.
 *
 * Pure by contract (CHR-3): no db import, no 'use server', no clock read. `now`
 * arrives on the input and the calendar index is injected, so the identical
 * function runs on the server and inside the browser store.
 *
 * Total by contract (CHR-8/17): every failure mode degrades to a warning. A plan
 * always renders.
 */
import {
  UNESTIMATED_DEFAULT_MINUTES,
  type CalendarIndex,
  type Placement,
  type ScheduleDependency,
  type ScheduleResource,
  type ScheduleTask,
  type SolveInput,
  type SolveResult,
  type SolveWarning,
  type WorkCalendar,
} from './types'

const MINUTE_MS = 60_000

type BuildIndex = (calendar: WorkCalendar) => CalendarIndex

interface Reservation {
  taskId: string
  start: number
  end: number
  lane: number
}

interface Edge {
  blockerTaskId: string
  blockedTaskId: string
  lagMinutes: number
}

interface PlacedTask {
  task: ScheduleTask
  index: CalendarIndex
  start: Date
  end: Date
  durationMin: number
  laneIndex: number
  ownerResourceId: string | null
}

/** Everything about a task that depends only on the task itself, never on its neighbours. */
interface TaskShape {
  resource: ScheduleResource | null
  index: CalendarIndex
  unestimated: boolean
  durationMin: number
  countsForCapacity: boolean
  lanes: number
}

/** A done or manual task: placed before the sweep so it defends its own slot (CHR-50). */
interface FixedSpan {
  start: Date
  end: Date
  laneIndex: number
  conflictTaskIds: string[]
}

function compareTasks(a: ScheduleTask, b: ScheduleTask): number {
  if (a.columnOrder !== b.columnOrder) return a.columnOrder - b.columnOrder
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

function isUsableDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function later(a: Date, b: Date): Date {
  return b.getTime() > a.getTime() ? b : a
}

function isImmovable(task: ScheduleTask): boolean {
  return task.status === 'done' || task.scheduleMode === 'manual'
}

/**
 * Share of the estimate still to be worked. `progress` is remaining effort for
 * IN-PROGRESS work only (CHR-51) — it is checklist-derived, so a backlog card with
 * nine of ten spec boxes ticked must still be scheduled at its full estimate.
 */
function remainingFraction(task: ScheduleTask): number {
  if (task.status === 'done') return 0
  if (task.status !== 'in-progress') return 1
  return 1 - clamp(task.progress ?? 0, 0, 100) / 100
}

/** Fallback axis when a calendar is missing or lane C's builder throws: continuous time. */
function continuousIndex(calendarId: string): CalendarIndex {
  return {
    calendarId,
    timezone: 'UTC',
    hoursPerDay: 24,
    // A continuous axis opens at local midnight and has no non-working gap, so
    // the chaining end and the display end are the same instant.
    dayStartMinute: 0,
    toWorkMinutes: (instant) => instant.getTime() / MINUTE_MS,
    fromWorkMinutes: (workMinutes) => new Date(Math.round(workMinutes * MINUTE_MS)),
    addDuration: (start, minutes) => new Date(start.getTime() + minutes * MINUTE_MS),
    workingMinutesBetween: (a, b) => (b.getTime() - a.getTime()) / MINUTE_MS,
    snapToNextWorkingInstant: (instant) => instant,
    isWorkingInstant: () => true,
    toDisplayEnd: (instant) => instant,
  }
}

/**
 * Calendar-aware shift in either direction. `addDuration` is only specified for
 * forward moves, so leads (CHR-15) and the backward pass travel the work axis.
 */
function shift(index: CalendarIndex, instant: Date, minutes: number): Date {
  if (minutes === 0) return instant
  let moved: Date
  if (minutes > 0) moved = index.addDuration(instant, minutes)
  else moved = index.fromWorkMinutes(index.toWorkMinutes(instant) + minutes)
  return isUsableDate(moved) ? moved : instant
}

/** Lowest lane inside the resource's own count that nothing overlapping holds, else null. */
function firstFreeLane(overlapping: Reservation[], concurrency: number): number | null {
  const taken = new Set(overlapping.map((r) => r.lane))
  for (let lane = 0; lane < concurrency; lane++) {
    if (!taken.has(lane)) return lane
  }
  return null
}

/**
 * A lane the interval can actually hold. Past the resource's count it keeps walking
 * outwards rather than stacking invisibly on lane 0 — an overflow lane is the visible
 * form of an overbooking the solver is not allowed to resolve by moving anything.
 */
function assignLane(overlapping: Reservation[], concurrency: number): number {
  const free = firstFreeLane(overlapping, concurrency)
  if (free !== null) return free
  const taken = new Set(overlapping.map((r) => r.lane))
  let lane = Math.max(1, Math.floor(concurrency))
  while (taken.has(lane)) lane++
  return lane
}

function overlaps(reservations: Reservation[], startMs: number, endMs: number): Reservation[] {
  return reservations.filter((r) => r.start < endMs && r.end > startMs)
}

/**
 * First instant at or after `from` where the resource has a free lane. Concurrency
 * falls straight out of the occupancy count (CHR-21) — no special-casing.
 */
function findSlot(
  index: CalendarIndex,
  reservations: Reservation[],
  concurrency: number,
  from: Date,
  durationMin: number,
): { start: Date; lane: number } {
  let candidate = from
  const maxPasses = reservations.length + 2
  for (let pass = 0; pass < maxPasses; pass++) {
    const startMs = candidate.getTime()
    const end = index.addDuration(candidate, durationMin)
    const endMs = isUsableDate(end) ? end.getTime() : startMs
    const busy = overlaps(reservations, startMs, endMs)
    if (busy.length < concurrency) {
      return { start: candidate, lane: assignLane(busy, concurrency) }
    }
    const ends = busy.map((r) => r.end).sort((a, b) => a - b)
    const freeingEnd = ends[Math.max(0, busy.length - concurrency)]
    if (!Number.isFinite(freeingEnd)) {
      return { start: candidate, lane: assignLane(busy, concurrency) }
    }
    const advanced = new Date(Math.max(freeingEnd, startMs + 1))
    const snapped = index.snapToNextWorkingInstant(advanced)
    candidate = isUsableDate(snapped) && snapped.getTime() > startMs ? snapped : advanced
  }
  const settled = index.addDuration(candidate, durationMin)
  const settledMs = isUsableDate(settled) ? settled.getTime() : candidate.getTime()
  return {
    start: candidate,
    lane: assignLane(overlaps(reservations, candidate.getTime(), settledMs), concurrency),
  }
}

/** The span a done or manual task occupies. Data-derived only, never a neighbour's end. */
function immovableSpan(task: ScheduleTask, shape: TaskShape, now: Date): { start: Date; end: Date } {
  if (task.status === 'done') {
    // Actuals are facts and never roll (CHR-50).
    const actualStart = isUsableDate(task.startedAt)
      ? task.startedAt
      : isUsableDate(task.completedAt)
        ? task.completedAt
        : now
    const actualEnd = isUsableDate(task.completedAt) ? task.completedAt : actualStart
    return { start: actualStart, end: later(actualStart, actualEnd) }
  }
  /*
   * A manual pin sits where the human put it: the actual start if work began,
   * else the typed start, else a constraint date, and only then `now`. The end
   * likewise honours the typed end before falling back to the estimate — a pin is
   * a span the user drew, not a duration the solver derives.
   */
  const pinned = isUsableDate(task.startedAt)
    ? task.startedAt
    : isUsableDate(task.plannedStart)
      ? task.plannedStart
      : isUsableDate(task.constraintDate)
        ? task.constraintDate
        : now
  const typedEnd =
    isUsableDate(task.plannedEnd) && task.plannedEnd.getTime() > pinned.getTime()
      ? task.plannedEnd
      : null
  const pinnedEnd = isUsableDate(task.completedAt)
    ? task.completedAt
    : typedEnd ?? shape.index.addDuration(pinned, shape.durationMin)
  return { start: pinned, end: later(pinned, isUsableDate(pinnedEnd) ? pinnedEnd : pinned) }
}

export function solve(input: SolveInput, buildIndex: BuildIndex): SolveResult {
  const warnings: SolveWarning[] = []
  const now = isUsableDate(input.now) ? input.now : new Date(0)

  const ordered: ScheduleTask[] = []
  const taskById = new Map<string, ScheduleTask>()
  for (const task of [...input.tasks].sort(compareTasks)) {
    if (taskById.has(task.id)) continue
    taskById.set(task.id, task)
    ordered.push(task)
  }
  const rank = new Map<string, number>()
  ordered.forEach((task, i) => rank.set(task.id, i))

  const calendarById = new Map<string, WorkCalendar>()
  for (const calendar of input.calendars) {
    if (!calendarById.has(calendar.id)) calendarById.set(calendar.id, calendar)
  }
  const indexCache = new Map<string, CalendarIndex>()
  const indexFor = (calendarId: string | null): CalendarIndex => {
    const key = calendarId ?? input.defaultCalendarId
    const cached = indexCache.get(key)
    if (cached) return cached
    const calendar =
      calendarById.get(key) ?? calendarById.get(input.defaultCalendarId) ?? input.calendars[0]
    let built: CalendarIndex
    if (!calendar) {
      built = continuousIndex(key)
    } else {
      try {
        built = buildIndex(calendar)
      } catch {
        built = continuousIndex(key)
      }
    }
    indexCache.set(key, built)
    return built
  }

  const resourceById = new Map<string, ScheduleResource>()
  for (const resource of input.resources) {
    if (!resourceById.has(resource.id)) resourceById.set(resource.id, resource)
  }

  const shapeCache = new Map<string, TaskShape>()
  const shapeOf = (task: ScheduleTask): TaskShape => {
    const cached = shapeCache.get(task.id)
    if (cached) return cached
    const ownerId = task.ownerResourceId
    const resource = ownerId ? resourceById.get(ownerId) ?? null : null
    const focusFactor = resource && resource.focusFactor > 0 ? resource.focusFactor : 1
    const unestimated = task.estimateMinutes === null || !Number.isFinite(task.estimateMinutes)
    const baseMinutes = unestimated
      ? UNESTIMATED_DEFAULT_MINUTES
      : Math.max(0, task.estimateMinutes as number)
    const remaining = remainingFraction(task)
    const built: TaskShape = {
      resource,
      index: indexFor(resource ? resource.calendarId : null),
      unestimated,
      durationMin: task.isMilestone
        ? 0
        : Math.max(0, Math.round((baseMinutes * remaining) / focusFactor)),
      // Unestimated work still renders but never consumes a lane (CHR-11).
      countsForCapacity: !!resource && !(unestimated && task.status !== 'done'),
      lanes: resource && resource.concurrency >= 1 ? Math.floor(resource.concurrency) : 1,
    }
    shapeCache.set(task.id, built)
    return built
  }

  const edges = collectEdges(input.dependencies, taskById, rank)
  const successors = new Map<string, Edge[]>()
  const predecessors = new Map<string, Edge[]>()
  for (const edge of edges) {
    const out = successors.get(edge.blockerTaskId)
    if (out) out.push(edge)
    else successors.set(edge.blockerTaskId, [edge])
    const into = predecessors.get(edge.blockedTaskId)
    if (into) into.push(edge)
    else predecessors.set(edge.blockedTaskId, [edge])
  }

  const dropped = breakCycles(ordered, successors, warnings)
  const liveOut = (id: string): Edge[] => (successors.get(id) ?? []).filter((e) => !dropped.has(e))
  const liveIn = (id: string): Edge[] => (predecessors.get(id) ?? []).filter((e) => !dropped.has(e))

  const topo = topologicalOrder(ordered, liveOut, liveIn, rank)

  const reservations = new Map<string, Reservation[]>()
  const slotsFor = (resourceId: string): Reservation[] => {
    const existing = reservations.get(resourceId)
    if (existing) return existing
    const created: Reservation[] = []
    reservations.set(resourceId, created)
    return created
  }
  const placed = new Map<string, PlacedTask>()

  /*
   * Pre-pass. Pins and actuals book their lanes before any auto work is placed, so
   * the sweep flows around them instead of over them. The order here is the spans'
   * own (start, end, id) and never board position, which is what makes a done or
   * manual placement identical under every columnOrder permutation.
   */
  const fixed = new Map<string, FixedSpan>()
  const immovables = ordered
    .filter(isImmovable)
    .map((task) => ({ task, span: immovableSpan(task, shapeOf(task), now) }))
    .sort((a, b) => {
      const byStart = a.span.start.getTime() - b.span.start.getTime()
      if (byStart !== 0) return byStart
      const byEnd = a.span.end.getTime() - b.span.end.getTime()
      if (byEnd !== 0) return byEnd
      return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0
    })
  for (const { task, span } of immovables) {
    const shape = shapeOf(task)
    const startMs = span.start.getTime()
    const endMs = span.end.getTime()
    let laneIndex = 0
    let conflictTaskIds: string[] = []
    if (shape.countsForCapacity && shape.resource && endMs > startMs) {
      const slots = slotsFor(shape.resource.id)
      const busy = overlaps(slots, startMs, endMs)
      const free = firstFreeLane(busy, shape.lanes)
      if (free === null) {
        laneIndex = assignLane(busy, shape.lanes)
        conflictTaskIds = busy.map((r) => r.taskId)
      } else {
        laneIndex = free
      }
      slots.push({ taskId: task.id, start: startMs, end: endMs, lane: laneIndex })
    }
    fixed.set(task.id, { start: span.start, end: span.end, laneIndex, conflictTaskIds })
  }

  for (const task of topo) {
    const shape = shapeOf(task)
    const ownerId = task.ownerResourceId
    const resource = shape.resource
    if (!ownerId) {
      warnings.push({
        kind: 'no-owner',
        taskIds: [task.id],
        message: `Task ${task.id} has no owner; scheduled without capacity constraints.`,
      })
    } else if (!resource) {
      warnings.push({
        kind: 'unknown-resource',
        taskIds: [task.id],
        message: `Task ${task.id} points at unknown resource ${ownerId}; scheduled without capacity constraints.`,
      })
    }

    const index = shape.index
    if (shape.unestimated && task.status !== 'done') {
      warnings.push({
        kind: 'unestimated',
        taskIds: [task.id],
        message: `Task ${task.id} is unestimated; given a ${UNESTIMATED_DEFAULT_MINUTES}-minute default span and excluded from capacity.`,
      })
    }

    const durationMin = shape.durationMin
    const pin = fixed.get(task.id)

    let start: Date
    let end: Date
    let laneIndex = 0

    if (pin) {
      start = pin.start
      end = pin.end
      laneIndex = pin.laneIndex
      if (pin.conflictTaskIds.length > 0 && resource) {
        warnings.push({
          kind: 'resource-overbooked',
          taskIds: [task.id, ...pin.conflictTaskIds],
          message: `Task ${task.id} is fixed onto ${resource.id} with no free lane and overlaps ${pin.conflictTaskIds.join(', ')}; kept on its own dates and shown on overflow lane ${laneIndex}.`,
        })
      }
    } else {
      /*
       * Nothing the sweep places may start in the past (CHR-49) — not a stale todo,
       * and not the remaining effort of work already under way. Its historical start
       * is a fact, but the future is where the rest of it gets done, where its lane
       * has to be booked, and where its successors have to be pushed to. A
       * `startedAt` still ahead of `now` is the only one that moves this later. Every
       * step below only ever pushes `earliest` forward, so this floor holds.
       */
      let earliest =
        task.status === 'in-progress' && isUsableDate(task.startedAt)
          ? later(task.startedAt, now)
          : now
      for (const edge of liveIn(task.id)) {
        const upstream = placed.get(edge.blockerTaskId)
        if (!upstream) continue
        earliest = later(earliest, shift(index, upstream.end, edge.lagMinutes))
      }
      if (task.constraintType === 'snet' && isUsableDate(task.constraintDate)) {
        earliest = later(earliest, task.constraintDate)
      }

      const snapped = index.snapToNextWorkingInstant(earliest)
      start = isUsableDate(snapped) ? later(earliest, snapped) : earliest

      if (shape.countsForCapacity && resource && durationMin > 0) {
        const slot = findSlot(index, slotsFor(resource.id), shape.lanes, start, durationMin)
        start = slot.start
        laneIndex = slot.lane
      }
      const computedEnd = index.addDuration(start, durationMin)
      end = later(start, isUsableDate(computedEnd) ? computedEnd : start)

      if (shape.countsForCapacity && resource && end.getTime() > start.getTime()) {
        slotsFor(resource.id).push({
          taskId: task.id,
          start: start.getTime(),
          end: end.getTime(),
          lane: laneIndex,
        })
      }
    }

    if (
      task.constraintType === 'fnlt' &&
      isUsableDate(task.constraintDate) &&
      end.getTime() > task.constraintDate.getTime()
    ) {
      warnings.push({
        kind: 'constraint-violated',
        taskIds: [task.id],
        message: `Task ${task.id} finishes after its finish-no-later-than date.`,
      })
    }
    if (
      task.constraintType === 'snet' &&
      isUsableDate(task.constraintDate) &&
      start.getTime() < task.constraintDate.getTime()
    ) {
      warnings.push({
        kind: 'constraint-violated',
        taskIds: [task.id],
        message: `Task ${task.id} starts before its start-no-earlier-than date.`,
      })
    }

    placed.set(task.id, {
      task,
      index,
      start,
      end,
      durationMin,
      laneIndex,
      ownerResourceId: ownerId,
    })
  }

  let projectEnd: Date | null = null
  for (const task of ordered) {
    const info = placed.get(task.id)
    if (!info) continue
    if (!projectEnd || info.end.getTime() > projectEnd.getTime()) projectEnd = info.end
  }

  // Backward pass: LF = min(LS of successors) - lag, LS = LF - duration (CHR-19).
  const lateStart = new Map<string, Date>()
  const totalFloat = new Map<string, number>()
  for (let i = topo.length - 1; i >= 0; i--) {
    const info = placed.get(topo[i].id)
    if (!info) continue
    let latestFinish: Date | null = null
    for (const edge of liveOut(topo[i].id)) {
      const successorLs = lateStart.get(edge.blockedTaskId)
      if (!successorLs) continue
      const bound = shift(info.index, successorLs, -edge.lagMinutes)
      if (!latestFinish || bound.getTime() < latestFinish.getTime()) latestFinish = bound
    }
    if (!latestFinish) latestFinish = projectEnd ?? info.end
    if (latestFinish.getTime() < info.end.getTime()) latestFinish = info.end
    const ls = shift(info.index, latestFinish, -info.durationMin)
    lateStart.set(topo[i].id, ls)
    const slack = info.index.workingMinutesBetween(info.start, ls)
    totalFloat.set(topo[i].id, Number.isFinite(slack) ? Math.max(0, Math.round(slack)) : 0)
  }

  /*
   * Every Date leaves by value. Internally the passes hand references around —
   * `later` returns one of its arguments, so `input.now`, a `startedAt` and a
   * `constraintDate` all reach this point unchanged. Handing those out would let a
   * renderer day-bucketing in place (`p.computedStart.setHours(0, 0, 0, 0)`) rewrite
   * the caller's own anchor and every placement sharing that instant, from one call
   * site. Warnings carry no Dates, so this and `projectEnd` are the whole boundary.
   */
  const placements: Placement[] = []
  for (const task of ordered) {
    const info = placed.get(task.id)
    if (!info) continue
    const float = totalFloat.get(task.id) ?? 0
    placements.push({
      taskId: task.id,
      computedStart: new Date(info.start.getTime()),
      computedEnd: new Date(info.end.getTime()),
      actualStart: isUsableDate(task.startedAt) ? new Date(task.startedAt.getTime()) : null,
      totalFloatMin: float,
      isCritical: float === 0,
      ownerResourceId: info.ownerResourceId,
      laneIndex: info.laneIndex,
    })
  }

  return {
    placements,
    projectEnd: projectEnd ? new Date(projectEnd.getTime()) : null,
    warnings,
  }
}

/** Known-task edges only, deduped (widest lag wins) and ordered for determinism (CHR-4). */
function collectEdges(
  dependencies: ScheduleDependency[],
  taskById: Map<string, ScheduleTask>,
  rank: Map<string, number>,
): Edge[] {
  const byKey = new Map<string, Edge>()
  for (const dep of dependencies) {
    if (!taskById.has(dep.blockerTaskId) || !taskById.has(dep.blockedTaskId)) continue
    const lag = Number.isFinite(dep.lagMinutes) ? dep.lagMinutes : 0
    const key = `${dep.blockerTaskId}>${dep.blockedTaskId}`
    const existing = byKey.get(key)
    // Every dependency type is treated as finish-to-start (CHR-14).
    if (!existing) {
      byKey.set(key, {
        blockerTaskId: dep.blockerTaskId,
        blockedTaskId: dep.blockedTaskId,
        lagMinutes: lag,
      })
    } else if (lag > existing.lagMinutes) {
      existing.lagMinutes = lag
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const blockerA = rank.get(a.blockerTaskId) ?? 0
    const blockerB = rank.get(b.blockerTaskId) ?? 0
    if (blockerA !== blockerB) return blockerA - blockerB
    const blockedA = rank.get(a.blockedTaskId) ?? 0
    const blockedB = rank.get(b.blockedTaskId) ?? 0
    return blockedA - blockedB
  })
}

/**
 * Iterative DFS in canonical order; every back edge is dropped for this solve.
 * Removing all back edges of a single DFS always yields a DAG, so one pass suffices.
 */
function breakCycles(
  ordered: ScheduleTask[],
  successors: Map<string, Edge[]>,
  warnings: SolveWarning[],
): Set<Edge> {
  const dropped = new Set<Edge>()
  const color = new Map<string, 1 | 2>()
  for (const root of ordered) {
    if (color.has(root.id)) continue
    color.set(root.id, 1)
    const stack: { id: string; cursor: number }[] = [{ id: root.id, cursor: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const out = successors.get(frame.id) ?? []
      if (frame.cursor >= out.length) {
        color.set(frame.id, 2)
        stack.pop()
        continue
      }
      const edge = out[frame.cursor]
      frame.cursor++
      if (dropped.has(edge)) continue
      const state = color.get(edge.blockedTaskId)
      if (state === 1) {
        dropped.add(edge)
        warnings.push({
          kind: 'cycle-edge-dropped',
          taskIds: [edge.blockerTaskId, edge.blockedTaskId],
          message: `Dependency ${edge.blockerTaskId} -> ${edge.blockedTaskId} closes a cycle and was ignored for this solve.`,
        })
        continue
      }
      if (state === 2) continue
      color.set(edge.blockedTaskId, 1)
      stack.push({ id: edge.blockedTaskId, cursor: 0 })
    }
  }
  return dropped
}

/** Kahn's algorithm over an explicitly ordered ready list — never Map iteration order (CHR-4). */
function topologicalOrder(
  ordered: ScheduleTask[],
  liveOut: (id: string) => Edge[],
  liveIn: (id: string) => Edge[],
  rank: Map<string, number>,
): ScheduleTask[] {
  const indegree = new Map<string, number>()
  for (const task of ordered) indegree.set(task.id, liveIn(task.id).length)

  const ready: ScheduleTask[] = ordered.filter((task) => (indegree.get(task.id) ?? 0) === 0)
  const result: ScheduleTask[] = []
  const emitted = new Set<string>()
  const byId = new Map(ordered.map((task) => [task.id, task]))

  const push = (task: ScheduleTask) => {
    const target = rank.get(task.id) ?? 0
    let lo = 0
    let hi = ready.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((rank.get(ready[mid].id) ?? 0) < target) lo = mid + 1
      else hi = mid
    }
    ready.splice(lo, 0, task)
  }

  while (ready.length > 0) {
    const task = ready.shift() as ScheduleTask
    if (emitted.has(task.id)) continue
    emitted.add(task.id)
    result.push(task)
    for (const edge of liveOut(task.id)) {
      const left = (indegree.get(edge.blockedTaskId) ?? 0) - 1
      indegree.set(edge.blockedTaskId, left)
      if (left <= 0) {
        const next = byId.get(edge.blockedTaskId)
        if (next && !emitted.has(next.id)) push(next)
      }
    }
  }
  // Belt and braces: anything still unseen renders in canonical order rather than vanishing.
  for (const task of ordered) if (!emitted.has(task.id)) result.push(task)
  return result
}
