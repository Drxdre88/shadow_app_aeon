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

/** Fallback axis when a calendar is missing or lane C's builder throws: continuous time. */
function continuousIndex(calendarId: string): CalendarIndex {
  return {
    calendarId,
    timezone: 'UTC',
    hoursPerDay: 24,
    toWorkMinutes: (instant) => instant.getTime() / MINUTE_MS,
    fromWorkMinutes: (workMinutes) => new Date(Math.round(workMinutes * MINUTE_MS)),
    addDuration: (start, minutes) => new Date(start.getTime() + minutes * MINUTE_MS),
    workingMinutesBetween: (a, b) => (b.getTime() - a.getTime()) / MINUTE_MS,
    snapToNextWorkingInstant: (instant) => instant,
    isWorkingInstant: () => true,
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

function firstFreeLane(overlapping: Reservation[], concurrency: number): number {
  const taken = new Set(overlapping.map((r) => r.lane))
  for (let lane = 0; lane < concurrency; lane++) {
    if (!taken.has(lane)) return lane
  }
  return 0
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
      return { start: candidate, lane: firstFreeLane(busy, concurrency) }
    }
    const ends = busy.map((r) => r.end).sort((a, b) => a - b)
    const freeingEnd = ends[Math.max(0, busy.length - concurrency)]
    if (!Number.isFinite(freeingEnd)) return { start: candidate, lane: 0 }
    const advanced = new Date(Math.max(freeingEnd, startMs + 1))
    const snapped = index.snapToNextWorkingInstant(advanced)
    candidate = isUsableDate(snapped) && snapped.getTime() > startMs ? snapped : advanced
  }
  return { start: candidate, lane: 0 }
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
  const placed = new Map<string, PlacedTask>()

  for (const task of topo) {
    const ownerId = task.ownerResourceId
    const resource = ownerId ? resourceById.get(ownerId) ?? null : null
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

    const index = indexFor(resource ? resource.calendarId : null)
    const focusFactor = resource && resource.focusFactor > 0 ? resource.focusFactor : 1
    const unestimated = task.estimateMinutes === null || !Number.isFinite(task.estimateMinutes)
    if (unestimated && task.status !== 'done') {
      warnings.push({
        kind: 'unestimated',
        taskIds: [task.id],
        message: `Task ${task.id} is unestimated; given a ${UNESTIMATED_DEFAULT_MINUTES}-minute default span and excluded from capacity.`,
      })
    }

    const baseMinutes = unestimated
      ? UNESTIMATED_DEFAULT_MINUTES
      : Math.max(0, task.estimateMinutes as number)
    const remainingFraction = 1 - clamp(task.progress ?? 0, 0, 100) / 100
    const durationMin = task.isMilestone
      ? 0
      : Math.max(0, Math.round((baseMinutes * remainingFraction) / focusFactor))

    // Unestimated work still renders but never consumes a lane (CHR-11).
    const countsForCapacity = !!resource && !(unestimated && task.status !== 'done')
    const lanes = resource && resource.concurrency >= 1 ? Math.floor(resource.concurrency) : 1
    let slots: Reservation[] = []
    if (countsForCapacity && resource) {
      const existing = reservations.get(resource.id)
      if (existing) {
        slots = existing
      } else {
        reservations.set(resource.id, slots)
      }
    }

    let start: Date
    let end: Date
    let laneIndex = 0

    if (task.status === 'done') {
      // Actuals are facts and never roll (CHR-50).
      const actualStart = isUsableDate(task.startedAt)
        ? task.startedAt
        : isUsableDate(task.completedAt)
          ? task.completedAt
          : now
      const actualEnd = isUsableDate(task.completedAt) ? task.completedAt : actualStart
      start = actualStart
      end = later(actualStart, actualEnd)
      laneIndex = firstFreeLane(overlaps(slots, start.getTime(), end.getTime()), lanes)
    } else if (task.scheduleMode === 'manual') {
      const pinned = isUsableDate(task.startedAt)
        ? task.startedAt
        : isUsableDate(task.constraintDate)
          ? task.constraintDate
          : now
      const pinnedEnd = isUsableDate(task.completedAt)
        ? task.completedAt
        : index.addDuration(pinned, durationMin)
      start = pinned
      end = later(pinned, isUsableDate(pinnedEnd) ? pinnedEnd : pinned)
      laneIndex = firstFreeLane(overlaps(slots, start.getTime(), end.getTime()), lanes)
    } else {
      let earliest =
        task.status === 'in-progress' && isUsableDate(task.startedAt) ? task.startedAt : now
      for (const edge of liveIn(task.id)) {
        const upstream = placed.get(edge.blockerTaskId)
        if (!upstream) continue
        earliest = later(earliest, shift(index, upstream.end, edge.lagMinutes))
      }
      if (task.constraintType === 'snet' && isUsableDate(task.constraintDate)) {
        earliest = later(earliest, task.constraintDate)
      }
      // A todo can never be placed in the past (CHR-49).
      if (task.status === 'todo') earliest = later(earliest, now)

      const snapped = index.snapToNextWorkingInstant(earliest)
      start = isUsableDate(snapped) ? later(earliest, snapped) : earliest

      if (countsForCapacity && resource && durationMin > 0) {
        const slot = findSlot(index, slots, lanes, start, durationMin)
        start = slot.start
        laneIndex = slot.lane
      }
      const computedEnd = index.addDuration(start, durationMin)
      end = later(start, isUsableDate(computedEnd) ? computedEnd : start)
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

    if (countsForCapacity && resource && end.getTime() > start.getTime()) {
      slots.push({ start: start.getTime(), end: end.getTime(), lane: laneIndex })
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

  const placements: Placement[] = []
  for (const task of ordered) {
    const info = placed.get(task.id)
    if (!info) continue
    const float = totalFloat.get(task.id) ?? 0
    placements.push({
      taskId: task.id,
      computedStart: info.start,
      computedEnd: info.end,
      totalFloatMin: float,
      isCritical: float === 0,
      ownerResourceId: info.ownerResourceId,
      laneIndex: info.laneIndex,
    })
  }

  return { placements, projectEnd, warnings }
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
