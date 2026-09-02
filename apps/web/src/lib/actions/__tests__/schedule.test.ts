import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/data/projects', () => ({
  verifyProjectAccess: vi.fn(),
}))

vi.mock('@/lib/data/schedule', () => ({
  ensureDefaultCalendar: vi.fn(),
  ensureResourcesForPeople: vi.fn(),
  findCalendars: vi.fn(),
  findDefaultCalendar: vi.fn(),
  findResources: vi.fn(),
  findScheduleInputs: vi.fn(),
  findSchedulePeople: vi.fn(),
  persistPlacements: vi.fn(),
}))

import { requireAuth } from '@/lib/actions/helpers'
import { verifyProjectAccess } from '@/lib/data/projects'
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
import { solveProject } from '../schedule'
import type { ScheduleTaskRow } from '@/lib/schedule/adapter'

/*
 * The five-card fixture board, solved by hand on the default calendar (Mon–Fri
 * 09:00–17:00 UTC). NOW is Monday 2026-09-07 09:00Z. Sizing is days.
 *
 *   A Design   1d  Alice          Mon 09:00 → Tue 09:00
 *   B Build    2d  Alice   A→B    Tue 09:00 → Thu 09:00
 *   C Docs     1d  Bob     A→C    Tue 09:00 → Wed 09:00   (float 1 day)
 *   D QA       1d  Bob     B,C→D  Thu 09:00 → Fri 09:00
 *   E Release  ◆   Alice   D→E    Fri 09:00               (milestone)
 *
 * Finish: Friday 2026-09-11 09:00Z on the working axis, i.e. close of business
 * Thursday 10 September when drawn. A, B, D, E are critical; C has 480 minutes.
 */
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW = new Date('2026-09-07T09:00:00.000Z')
const T = (day: number) => new Date(Date.UTC(2026, 8, day, 9, 0, 0))
const CAL = { id: 'cal-default', timezone: 'UTC', hoursPerDay: '8.00', dayStartMinute: 540, workweek: 62 }
const ALICE = { id: 'r-alice', kind: 'user', userId: 'u-alice', virtualMemberId: null, parentResourceId: null, calendarId: null, label: 'Alice', concurrency: 1, focusFactor: '1.00', orderIndex: 0 }
const BOB = { id: 'r-bob', kind: 'virtual', userId: null, virtualMemberId: 'v-bob', parentResourceId: null, calendarId: null, label: 'Bob', concurrency: 1, focusFactor: '1.00', orderIndex: 1 }
const CAROL_LEFT = { id: 'r-carol', kind: 'user', userId: 'u-carol', virtualMemberId: null, parentResourceId: null, calendarId: null, label: 'Carol', concurrency: 1, focusFactor: '1.00', orderIndex: 2 }
const access = (role: string) => ({ project: { id: PROJECT_ID } as never, role })

function card(id: string, over: Partial<ScheduleTaskRow> = {}): ScheduleTaskRow {
  return {
    id,
    status: 'todo',
    priority: 'medium',
    columnId: 'col-todo',
    startDate: null,
    endDate: null,
    size: 1,
    progress: null,
    orderIndex: 0,
    completedAt: null,
    estimateMinutes: null,
    scheduleMode: 'auto',
    constraintType: 'asap',
    constraintDate: null,
    isMilestone: false,
    ownerResourceId: null,
    startedAt: null,
    ...over,
  }
}

const at = (minute: number) => new Date(NOW.getTime() - 60 * 60_000 + minute * 60_000)

function fixtureInputs() {
  return {
    settings: { sizing: { unit: 'days' } },
    tasks: [
      card('A', { orderIndex: 0 }),
      card('B', { orderIndex: 1, size: 2 }),
      card('C', { orderIndex: 2 }),
      card('D', { orderIndex: 3 }),
      card('E', { orderIndex: 4, isMilestone: true, estimateMinutes: 60 }),
    ],
    columns: [{ id: 'col-todo', orderIndex: 0 }],
    assignments: [
      { taskId: 'A', userId: 'u-alice', virtualMemberId: null, assignedAt: at(0) },
      { taskId: 'B', userId: 'u-alice', virtualMemberId: null, assignedAt: at(1) },
      { taskId: 'C', userId: null, virtualMemberId: 'v-bob', assignedAt: at(2) },
      { taskId: 'D', userId: null, virtualMemberId: 'v-bob', assignedAt: at(3) },
      { taskId: 'E', userId: 'u-alice', virtualMemberId: null, assignedAt: at(4) },
    ],
    dependencies: [
      { blockerTaskId: 'A', blockedTaskId: 'B' },
      { blockerTaskId: 'A', blockedTaskId: 'C' },
      { blockerTaskId: 'B', blockedTaskId: 'D' },
      { blockerTaskId: 'C', blockedTaskId: 'D' },
      { blockerTaskId: 'D', blockedTaskId: 'E' },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(requireAuth).mockResolvedValue('u-alice')
  vi.mocked(verifyProjectAccess).mockResolvedValue(access('editor') as never)
  vi.mocked(ensureDefaultCalendar).mockResolvedValue(CAL)
  vi.mocked(findDefaultCalendar).mockResolvedValue(CAL)
  vi.mocked(findResources).mockResolvedValue([ALICE, BOB])
  vi.mocked(findSchedulePeople).mockResolvedValue([
    { kind: 'user', userId: 'u-alice', label: 'Alice' },
    { kind: 'virtual', virtualMemberId: 'v-bob', label: 'Bob' },
  ])
  vi.mocked(ensureResourcesForPeople).mockResolvedValue([ALICE, BOB])
  vi.mocked(findCalendars).mockResolvedValue({ calendars: [CAL], exceptions: [] })
  vi.mocked(findScheduleInputs).mockResolvedValue(fixtureInputs())
  vi.mocked(persistPlacements).mockResolvedValue(5)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('solveProject', () => {
  it('gates on membership before touching anything', async () => {
    vi.mocked(verifyProjectAccess).mockResolvedValueOnce(null)
    await expect(solveProject(PROJECT_ID)).rejects.toThrow('unauthorized')
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Unauthorized'))
    await expect(solveProject(PROJECT_ID)).rejects.toThrow('Unauthorized')
    expect(ensureDefaultCalendar).not.toHaveBeenCalled()
    expect(findDefaultCalendar).not.toHaveBeenCalled()
    expect(findSchedulePeople).not.toHaveBeenCalled()
    expect(persistPlacements).not.toHaveBeenCalled()
  })

  it('derives lanes from the project people, solves from now and persists every placement once', async () => {
    const schedule = await solveProject(PROJECT_ID)

    expect(verifyProjectAccess).toHaveBeenCalledWith(PROJECT_ID, 'u-alice')
    expect(ensureResourcesForPeople).toHaveBeenCalledWith(PROJECT_ID, [
      { kind: 'user', userId: 'u-alice', label: 'Alice' },
      { kind: 'virtual', virtualMemberId: 'v-bob', label: 'Bob' },
    ])
    expect(persistPlacements).toHaveBeenCalledTimes(1)
    const [projectId, persisted] = vi.mocked(persistPlacements).mock.calls[0]
    expect(projectId).toBe(PROJECT_ID)
    expect(persisted.map((p) => p.taskId).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])

    const byId = new Map(schedule.placements.map((p) => [p.taskId, p]))
    expect(byId.get('A')).toMatchObject({ computedStart: T(7), computedEnd: T(8), ownerResourceId: 'r-alice', isCritical: true })
    expect(byId.get('B')).toMatchObject({ computedStart: T(8), computedEnd: T(10), ownerResourceId: 'r-alice', isCritical: true })
    expect(byId.get('C')).toMatchObject({ computedStart: T(8), computedEnd: T(9), ownerResourceId: 'r-bob', totalFloatMin: 480, isCritical: false })
    expect(byId.get('D')).toMatchObject({ computedStart: T(10), computedEnd: T(11), ownerResourceId: 'r-bob', isCritical: true })
    expect(byId.get('E')).toMatchObject({ computedStart: T(11), computedEnd: T(11), ownerResourceId: 'r-alice', isCritical: true })
    expect(schedule.projectEnd).toEqual(T(11))
    expect(schedule.warnings).toEqual([])
    expect(schedule.now).toEqual(NOW)
    expect(schedule.defaultCalendarId).toBe('cal-default')
    expect(schedule.lanes.map((l) => [l.id, l.userId, l.virtualMemberId, l.label])).toEqual([
      ['r-alice', 'u-alice', null, 'Alice'],
      ['r-bob', null, 'v-bob', 'Bob'],
    ])
    expect(schedule.calendars).toEqual([
      { id: 'cal-default', timezone: 'UTC', hoursPerDay: 8, dayStartMinute: 540, workweek: 62, exceptions: [] },
    ])
  })

  it('reports an unowned card as a warning rather than failing the solve', async () => {
    const inputs = fixtureInputs()
    inputs.assignments = inputs.assignments.filter((a) => a.taskId !== 'C')
    vi.mocked(findScheduleInputs).mockResolvedValue(inputs)

    const schedule = await solveProject(PROJECT_ID)
    expect(schedule.warnings.map((w) => [w.kind, w.taskIds])).toEqual([['no-owner', ['C']]])
    expect(schedule.placements).toHaveLength(5)
    expect(persistPlacements).toHaveBeenCalledTimes(1)
  })

  it('always includes the default calendar even when the calendar read races the create', async () => {
    vi.mocked(findCalendars).mockResolvedValue({ calendars: [], exceptions: [] })
    const schedule = await solveProject(PROJECT_ID)
    expect(schedule.calendars.map((c) => c.id)).toEqual(['cal-default'])
    expect(schedule.projectEnd).toEqual(T(11))
  })

  it('a viewer gets the same plan solved in memory and writes nothing', async () => {
    vi.mocked(verifyProjectAccess).mockResolvedValue(access('viewer') as never)
    vi.mocked(findResources).mockResolvedValue([ALICE])

    const schedule = await solveProject(PROJECT_ID)

    expect(ensureDefaultCalendar).not.toHaveBeenCalled()
    expect(ensureResourcesForPeople).not.toHaveBeenCalled()
    expect(persistPlacements).not.toHaveBeenCalled()
    expect(findDefaultCalendar).toHaveBeenCalledWith(PROJECT_ID)
    expect(findResources).toHaveBeenCalledWith(PROJECT_ID)

    expect(schedule.lanes.map((l) => [l.id, l.userId, l.virtualMemberId, l.label])).toEqual([
      ['r-alice', 'u-alice', null, 'Alice'],
      ['unsaved:v-bob', null, 'v-bob', 'Bob'],
    ])
    const byId = new Map(schedule.placements.map((p) => [p.taskId, p]))
    expect(byId.get('C')).toMatchObject({ computedStart: T(8), computedEnd: T(9), ownerResourceId: 'unsaved:v-bob' })
    expect(byId.get('D')).toMatchObject({ computedStart: T(10), computedEnd: T(11), ownerResourceId: 'unsaved:v-bob' })
    expect(schedule.projectEnd).toEqual(T(11))
    expect(schedule.warnings).toEqual([])
  })

  it('a viewer of a project with no calendar yet solves on an unsaved default', async () => {
    vi.mocked(verifyProjectAccess).mockResolvedValue(access('viewer') as never)
    vi.mocked(findDefaultCalendar).mockResolvedValue(null)
    vi.mocked(findCalendars).mockResolvedValue({ calendars: [], exceptions: [] })

    const schedule = await solveProject(PROJECT_ID)

    expect(schedule.defaultCalendarId).toBe('unsaved:default')
    expect(schedule.calendars).toEqual([
      { id: 'unsaved:default', timezone: 'UTC', hoursPerDay: 8, dayStartMinute: 540, workweek: 62, exceptions: [] },
    ])
    expect(schedule.projectEnd).toEqual(T(11))
    expect(ensureDefaultCalendar).not.toHaveBeenCalled()
  })

  it('someone who left the project keeps their row but loses their lane, and cards pinned to them fall through', async () => {
    vi.mocked(ensureResourcesForPeople).mockResolvedValue([ALICE, BOB, CAROL_LEFT])
    const inputs = fixtureInputs()
    inputs.tasks[0] = card('A', { orderIndex: 0, ownerResourceId: 'r-carol' })
    vi.mocked(findScheduleInputs).mockResolvedValue(inputs)

    const schedule = await solveProject(PROJECT_ID)

    expect(schedule.lanes.map((l) => l.id)).toEqual(['r-alice', 'r-bob'])
    const a = schedule.placements.find((p) => p.taskId === 'A')
    expect(a).toMatchObject({ computedStart: T(7), computedEnd: T(8), ownerResourceId: 'r-alice' })
    expect(schedule.warnings).toEqual([])
  })
})
