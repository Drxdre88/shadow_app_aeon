/** @vitest-environment jsdom */
import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'

// Locks the priority-grouping layout fix. TrophyCard is `h-full`; in priority
// mode the cards used to be stacked in a plain block inside a stretched grid
// cell, so every card's percentage height resolved against the whole stack
// and the columns grew without bound. Each stack is now a CSS grid (a card's
// 100% resolves against its own row) and the columns no longer stretch.

import { TrophyRoom } from '../TrophyRoom'
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
    daysTaken: 3,
    labelSnapshot: [],
    checklistSnapshot: {},
    metadata: {},
    archivedAt: new Date('2026-08-01T10:00:00'),
    completedAt: new Date('2026-08-01T10:00:00'),
    originalCreatedAt: new Date('2026-07-29T10:00:00'),
    ...overrides,
  } as TaskVault
}

const TASKS: TaskVault[] = [
  vaultTask('Alpha', { priority: 'low', completedAt: new Date('2026-08-03T10:00:00') }),
  vaultTask('Bravo', { priority: 'urgent', completedAt: new Date('2026-08-01T10:00:00') }),
  vaultTask('Charlie', { priority: 'p0', completedAt: new Date('2026-08-02T10:00:00') }),
  vaultTask('Delta', { priority: 'urgent', completedAt: new Date('2026-07-20T10:00:00') }),
  vaultTask('Echo', { priority: 'medium', completedAt: new Date('2026-06-11T10:00:00') }),
  vaultTask('Foxtrot', { priority: 'high', completedAt: new Date('2026-05-05T10:00:00') }),
]

vi.mock('@/lib/actions/vault', () => ({
  getVaultTasks: vi.fn(async () => TASKS),
  getVaultStatsSA: vi.fn(async () => ({
    total: TASKS.length,
    avgDays: 3,
    byPriority: { low: 1, medium: 1, high: 1, urgent: 2 },
    thisWeek: 0,
  })),
  restoreVaultTask: vi.fn(),
}))

vi.mock('@/lib/actions/activity', () => ({
  getActivityFeed: vi.fn(async () => []),
}))

const PRIORITIES = [
  { id: 'low', name: 'low', color: '#86efac' },
  { id: 'medium', name: 'medium', color: '#fde68a' },
  { id: 'high', name: 'high', color: '#fb923c' },
  { id: 'urgent', name: 'urgent', color: '#ef4444' },
  { id: 'p0', name: 'Drop everything', color: '#a855f7' },
]

async function renderRoom() {
  const view = render(
    <StrictMode>
      <TrophyRoom projectId="project-1" />
    </StrictMode>
  )
  await screen.findByText('Alpha')
  return view
}

function groupButton(label: string) {
  return within(screen.getByRole('group', { name: 'Group by' })).getByRole('button', { name: label })
}

function cardOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest('.h-full')
  if (!card) throw new Error(`no card element for ${name}`)
  return card as HTMLElement
}

beforeEach(() => {
  useThemeStore.setState({ priorities: PRIORITIES, smoothUiRenders: false })
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('TrophyRoom priority grouping', () => {
  it('renders one bounded grid column per configured level, each card exactly once', async () => {
    await renderRoom()
    fireEvent.click(groupButton('Priority'))

    const columns = PRIORITIES.map((p) => screen.getByRole('region', { name: p.name }))
    expect(columns).toHaveLength(PRIORITIES.length)

    for (const task of TASKS) {
      expect(screen.getAllByText(task.name)).toHaveLength(1)
      const stack = cardOf(task.name).parentElement!
      expect(stack.classList.contains('grid')).toBe(true)
      expect(stack.classList.contains('space-y-2')).toBe(false)
    }

    const outer = columns[0].parentElement!
    expect(outer.classList.contains('grid')).toBe(true)
    expect(outer.classList.contains('items-start')).toBe(true)

    const urgent = screen.getByRole('region', { name: 'urgent' })
    expect(within(urgent).getByText('Bravo')).toBeTruthy()
    expect(within(urgent).getByText('Delta')).toBeTruthy()
    expect(within(urgent).getByText('2')).toBeTruthy()
  })

  it('survives switching timeline -> priority -> timeline -> priority without duplicating cards', async () => {
    await renderRoom()
    fireEvent.click(groupButton('Priority'))
    fireEvent.click(groupButton('Timeline'))
    fireEvent.click(groupButton('Priority'))

    for (const task of TASKS) {
      expect(screen.getAllByText(task.name)).toHaveLength(1)
    }
    expect(screen.getAllByRole('region').filter((r) => PRIORITIES.some((p) => p.name === r.getAttribute('aria-label')))).toHaveLength(PRIORITIES.length)
  })

  it('shows the insights band and lets the user collapse it', async () => {
    await renderRoom()
    expect(screen.getByRole('region', { name: 'Trophies over time' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Cycle time' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'When trophies land' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Insights' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Trophies over time' })).toBeNull())
  })
})

const NAMES = TASKS.map((t) => t.name)
const shownNames = () => screen.getAllByText((text) => NAMES.includes(text)).map((el) => el.textContent)

function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
}

describe('TrophyRoom sort and filter', () => {
  it('sorting by Oldest reorders the cards oldest-first', async () => {
    await renderRoom()
    fireEvent.click(groupButton('Label'))
    expect(shownNames()).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta', 'Echo', 'Foxtrot'])

    openFilters()
    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }))
    expect(shownNames()).toEqual(['Foxtrot', 'Echo', 'Delta', 'Bravo', 'Charlie', 'Alpha'])
  })

  it('a priority filter drops the shown/total counter and hides the other cards', async () => {
    await renderRoom()
    expect(screen.getByText('6/6')).toBeTruthy()

    openFilters()
    fireEvent.click(screen.getByRole('button', { name: 'urgent' }))

    expect(screen.getByText('2/6')).toBeTruthy()
    expect(shownNames().sort()).toEqual(['Bravo', 'Delta'])
    expect(screen.queryByText('Alpha')).toBeNull()
  })
})

describe('TrophyRoom since-last-visit chip', () => {
  const KEY = 'aeon:trophy:last-visit:project-1'

  it('an old visit shows the delta chip and the key is rewritten to now', async () => {
    const before = Date.now()
    localStorage.setItem(KEY, '2026-01-01T00:00:00.000Z')
    await renderRoom()

    expect(await screen.findByText('+6 since last visit')).toBeTruthy()
    const rewritten = localStorage.getItem(KEY)!
    expect(new Date(rewritten).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('an empty stored value shows no chip and still stamps the visit', async () => {
    localStorage.setItem(KEY, '')
    await renderRoom()
    await waitFor(() => expect(Number.isNaN(new Date(localStorage.getItem(KEY)!).getTime())).toBe(false))
    expect(screen.queryByText(/since last visit/)).toBeNull()
  })

  it('a garbage stored value shows no chip, does not throw, and is overwritten', async () => {
    localStorage.setItem(KEY, 'not-a-date')
    await renderRoom()
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBe('not-a-date'))
    expect(Number.isNaN(new Date(localStorage.getItem(KEY)!).getTime())).toBe(false)
    expect(screen.queryByText(/since last visit/)).toBeNull()
  })
})
