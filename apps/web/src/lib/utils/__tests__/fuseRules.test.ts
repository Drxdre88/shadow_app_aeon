import { describe, it, expect } from 'vitest'
import {
  DESCRIPTION_SEPARATOR,
  MAX_TASK_SIZE,
  earliestDate,
  latestDate,
  maxPriority,
  mergeChecklistOrder,
  mergeDescriptions,
  mergeTaskFields,
  repointDependencies,
  sumCapped,
  unionIds,
  type FusableFields,
} from '../fuseRules'

// The merge rules a fusion applies. Pure, shared by the server transaction
// and the client's optimistic preview — so one set of tests pins both.

describe('scalar rules', () => {
  it('priority takes the higher of the two', () => {
    expect(maxPriority('low', 'urgent')).toBe('urgent')
    expect(maxPriority('high', 'medium')).toBe('high')
    expect(maxPriority('medium', 'medium')).toBe('medium')
    expect(maxPriority('weird', 'low')).toBe('medium')
  })

  it('description appends the source under a separator, skipping blanks', () => {
    expect(mergeDescriptions('A', 'B')).toBe(`A${DESCRIPTION_SEPARATOR}B`)
    expect(mergeDescriptions('A', '   ')).toBe('A')
    expect(mergeDescriptions(null, 'B')).toBe('B')
    expect(mergeDescriptions(null, null)).toBeNull()
  })

  it('dates widen to the earliest start and the latest end, ignoring nulls', () => {
    expect(earliestDate('2026-09-05', '2026-09-01')).toBe('2026-09-01')
    expect(latestDate('2026-09-05', '2026-09-01')).toBe('2026-09-05')
    expect(earliestDate(null, '2026-09-01')).toBe('2026-09-01')
    expect(latestDate('2026-09-05', null)).toBe('2026-09-05')
    expect(earliestDate(null, null)).toBeNull()
    const a = new Date('2026-01-01')
    const b = new Date('2026-02-01')
    expect(earliestDate(a, b)).toBe(a)
    expect(latestDate(a, b)).toBe(b)
  })

  it('size sums when both are set, capped at the validator maximum', () => {
    expect(sumCapped(2, 3, MAX_TASK_SIZE)).toBe(5)
    expect(sumCapped(15, 8, MAX_TASK_SIZE)).toBe(MAX_TASK_SIZE)
    expect(sumCapped(null, 3, MAX_TASK_SIZE)).toBe(3)
    expect(sumCapped(2, undefined, MAX_TASK_SIZE)).toBe(2)
    expect(sumCapped(null, null, MAX_TASK_SIZE)).toBeNull()
    expect(sumCapped(90, 60)).toBe(150)
  })

  it('mergeTaskFields keeps the survivor\'s colour/column out and trims the name', () => {
    const survivor: FusableFields = { name: 'S', description: 'sd', priority: 'low', startDate: '2026-09-10', endDate: '2026-09-12', onTimeline: false, size: 1, estimateMinutes: null }
    const source: FusableFields = { name: 'X', description: 'xd', priority: 'high', startDate: '2026-09-08', endDate: null, onTimeline: true, size: 2.5, estimateMinutes: 30 }
    expect(mergeTaskFields(survivor, source, '  Fused  ')).toEqual({
      name: 'Fused',
      description: `sd${DESCRIPTION_SEPARATOR}xd`,
      priority: 'high',
      startDate: '2026-09-08',
      endDate: '2026-09-12',
      onTimeline: true,
      size: 3.5,
      estimateMinutes: 30,
    })
  })
})

describe('unionIds', () => {
  it('keeps the survivor\'s order and appends the source\'s new ids once', () => {
    expect(unionIds(['a', 'b'], ['b', 'c', 'a', 'c'])).toEqual(['a', 'b', 'c'])
    expect(unionIds([], [])).toEqual([])
  })
})

describe('mergeChecklistOrder', () => {
  const item = (id: string, groupName: string, orderIndex: number) => ({ id, groupName, orderIndex })

  it('appends source groups that exist on the survivor to the end of that group, new groups after everything', () => {
    const survivor = [item('s1', 'Checklist', 0), item('s2', 'QA', 1), item('s3', 'Checklist', 2)]
    const source = [item('x1', 'QA', 0), item('x2', 'Deploy', 1), item('x3', 'Checklist', 2)]
    const merged = mergeChecklistOrder(survivor, source)
    expect(merged.map((m) => m.id)).toEqual(['s1', 's2', 'x1', 's3', 'x3', 'x2'])
    expect(merged.map((m) => m.orderIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(merged.find((m) => m.id === 'x1')?.groupName).toBe('QA')
  })

  it('an orderIndex tie on the survivor appends each source item exactly once', () => {
    const survivor = [item('s1', 'Checklist', 0), item('s2', 'Checklist', 0), item('s3', 'QA', 0), item('s4', 'QA', 0)]
    const source = [item('x1', 'Checklist', 0), item('x2', 'QA', 1)]
    const merged = mergeChecklistOrder(survivor, source)
    expect(merged.map((m) => m.id)).toEqual(['s1', 's2', 'x1', 's3', 's4', 'x2'])
    expect(merged.map((m) => m.orderIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length)
  })

  it('an empty survivor checklist takes the source\'s in order', () => {
    const source = [item('x2', 'B', 5), item('x1', 'A', 1)]
    expect(mergeChecklistOrder([], source).map((m) => m.id)).toEqual(['x1', 'x2'])
  })

  it('keeps the survivor untouched when the source has nothing', () => {
    const survivor = [item('s2', 'A', 4), item('s1', 'A', 2)]
    expect(mergeChecklistOrder(survivor, [])).toEqual([
      { id: 's1', orderIndex: 0, groupName: 'A' },
      { id: 's2', orderIndex: 1, groupName: 'A' },
    ])
  })
})

describe('repointDependencies', () => {
  const edge = (blockerTaskId: string, blockedTaskId: string) => ({ blockerTaskId, blockedTaskId })

  it('re-points the source\'s edges at the survivor', () => {
    const inserts = repointDependencies([edge('x', 'c'), edge('d', 'x')], [], 'x', 's')
    expect(inserts).toEqual([edge('s', 'c'), edge('d', 's')])
  })

  it('drops an edge between the two cards (it would become a self-reference)', () => {
    expect(repointDependencies([edge('x', 's')], [edge('x', 's')], 'x', 's')).toEqual([])
    expect(repointDependencies([edge('s', 'x')], [], 'x', 's')).toEqual([])
  })

  it('drops re-pointed edges the survivor already has, and duplicates among the inserts', () => {
    const inserts = repointDependencies([edge('x', 'c'), edge('x', 'c')], [edge('s', 'c'), edge('s', 'd')], 'x', 's')
    expect(inserts).toEqual([])
    expect(repointDependencies([edge('x', 'c'), edge('x', 'c')], [], 'x', 's')).toEqual([edge('s', 'c')])
  })
})
