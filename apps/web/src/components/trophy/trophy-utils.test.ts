import { describe, it, expect } from 'vitest'
import { groupByPriority } from './trophy-utils'
import { NO_PRIORITY_KEY } from './trophy-stats'
import type { TaskVault } from '@/lib/db/schema'

const FACTORY_ORDER = ['urgent', 'high', 'medium', 'low']

let seq = 0
function vaultTask(priority: string | null): TaskVault {
  seq += 1
  return {
    id: `vault-${seq}`,
    projectId: 'project-1',
    originalTaskId: null,
    name: `Trophy ${seq}`,
    description: null,
    priority: priority as string,
    color: 'purple',
    columnName: 'Done',
    size: null,
    daysTaken: null,
    labelSnapshot: [],
    checklistSnapshot: {},
    metadata: {},
    archivedAt: new Date('2026-08-01T10:00:00'),
    completedAt: new Date('2026-08-01T10:00:00'),
    originalCreatedAt: new Date('2026-07-01T10:00:00'),
  } as TaskVault
}

describe('groupByPriority', () => {
  it('keeps every configured level as a section, empty ones included', () => {
    const sections = groupByPriority([vaultTask('high')], FACTORY_ORDER)
    expect(sections.map((s) => s.key)).toEqual(FACTORY_ORDER)
    expect(sections.find((s) => s.key === 'high')!.tasks).toHaveLength(1)
    expect(sections.find((s) => s.key === 'low')!.tasks).toHaveLength(0)
  })

  it('groups a custom priority level into its own section without throwing', () => {
    // The old implementation pre-seeded a map with only the four factory ids and
    // dereferenced the miss, so this input threw a TypeError.
    const sections = groupByPriority(
      [vaultTask('p0'), vaultTask('p0'), vaultTask('medium')],
      ['p0', ...FACTORY_ORDER]
    )
    const custom = sections.find((s) => s.key === 'p0')
    expect(custom!.tasks).toHaveLength(2)
    expect(sections.find((s) => s.key === 'medium')!.tasks).toHaveLength(1)
  })

  it('appends an unconfigured id as its own section rather than mis-filing it', () => {
    const sections = groupByPriority([vaultTask('retired-level')], FACTORY_ORDER)
    expect(sections.map((s) => s.key)).toEqual([...FACTORY_ORDER, 'retired-level'])
    expect(sections.find((s) => s.key === 'medium')!.tasks).toHaveLength(0)
  })

  it('puts a missing priority in its own honest bucket', () => {
    const sections = groupByPriority([vaultTask(null)], FACTORY_ORDER)
    const none = sections.find((s) => s.key === NO_PRIORITY_KEY)
    expect(none).toMatchObject({ label: 'No priority' })
    expect(none!.tasks).toHaveLength(1)
    expect(sections.find((s) => s.key === 'medium')!.tasks).toHaveLength(0)
  })
})
