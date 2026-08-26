/** @vitest-environment jsdom */
import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

// Locks the sort-direction fix: toggleSort used to queue setSortDir from inside
// the setSortKey updater. Strict Mode double-invokes updaters, so the direction
// flipped twice per click and clicking the active header did nothing visible.
// These tests render under <StrictMode> deliberately — that is the environment
// the App Router runs in.

import { TrophyTable } from '../TrophyTable'
import { useThemeStore } from '@/stores/themeStore'
import type { TaskVault } from '@/lib/db/schema'

function vaultTask(name: string, overrides: Partial<TaskVault> = {}): TaskVault {
  return {
    id: `vault-${name}`,
    projectId: 'project-1',
    originalTaskId: null,
    name,
    description: null,
    priority: 'medium',
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
    ...overrides,
  } as TaskVault
}

const TASKS: TaskVault[] = [
  vaultTask('Alpha', { completedAt: new Date('2026-08-03T10:00:00'), priority: 'low' }),
  vaultTask('Bravo', { completedAt: new Date('2026-08-01T10:00:00'), priority: 'urgent' }),
  vaultTask('Charlie', { completedAt: new Date('2026-08-02T10:00:00'), priority: 'p0' }),
]

function renderTable(tasks: TaskVault[] = TASKS) {
  return render(
    <StrictMode>
      <TrophyTable tasks={tasks} onRestore={() => {}} onSelect={() => {}} />
    </StrictMode>
  )
}

/** Trophy names in the order the table currently renders them. */
function renderedNames(): string[] {
  const rows = screen.getAllByRole('row').slice(1) // drop the header row
  return rows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

function clickHeader(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }))
}

beforeEach(() => {
  useThemeStore.setState({
    priorities: [
      { id: 'low', name: 'low', color: '#86efac' },
      { id: 'medium', name: 'medium', color: '#fde68a' },
      { id: 'high', name: 'high', color: '#fb923c' },
      { id: 'urgent', name: 'urgent', color: '#ef4444' },
      { id: 'p0', name: 'Drop everything', color: '#a855f7' },
    ],
  })
})

afterEach(() => {
  cleanup()
})

describe('TrophyTable sorting', () => {
  it('defaults to newest completed first', () => {
    renderTable()
    expect(renderedNames()).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('flips the direction when the ACTIVE column header is clicked', () => {
    renderTable()
    expect(renderedNames()).toEqual(['Alpha', 'Charlie', 'Bravo']) // completed, desc

    clickHeader('Completed')
    expect(renderedNames()).toEqual(['Bravo', 'Charlie', 'Alpha']) // asc

    clickHeader('Completed')
    expect(renderedNames()).toEqual(['Alpha', 'Charlie', 'Bravo']) // back to desc
  })

  it('switching to a different column applies that column default direction once', () => {
    renderTable()

    clickHeader('Trophy') // name -> ascending default
    expect(renderedNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])

    clickHeader('Trophy') // active column -> flip to descending
    expect(renderedNames()).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('sorts by the configured priority order, custom levels included', () => {
    renderTable()

    clickHeader('Priority') // priority -> descending default (highest first)
    expect(renderedNames()).toEqual(['Charlie', 'Bravo', 'Alpha']) // p0 > urgent > low

    clickHeader('Priority') // flip to ascending
    expect(renderedNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})
