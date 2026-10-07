import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { MorningCockpit } from '@/lib/data/morning-cockpit'
import { MorningCockpitView } from '../MorningCockpitView'

const empty = { count: 0, items: [] }

const base: MorningCockpit = {
  generatedAt: '2026-10-07T06:30:00.000Z',
  today: '2026-10-07',
  since: '2026-10-06T17:00:00.000Z',
  predictions: empty,
  asks: empty,
  promises: empty,
  proposals: empty,
  staleCards: empty,
  sessions: empty,
  repoLessons: empty,
}

afterEach(cleanup)

describe('MorningCockpitView', () => {
  it('shows plain-words empty states for every section', () => {
    render(<MorningCockpitView cockpit={base} />)
    expect(screen.getByText('Nothing due today.')).toBeTruthy()
    expect(screen.getByText('No questions waiting for you.')).toBeTruthy()
    expect(screen.getByText('No agents ran overnight.')).toBeTruthy()
    expect(screen.getByText('No new lessons since yesterday.')).toBeTruthy()
  })

  it('links each row to where it is acted on and shows the overflow', () => {
    render(<MorningCockpitView cockpit={{
      ...base,
      predictions: { count: 1, items: [{ id: 'r1', number: 'R1', claim: 'Cockpit ships this week', probability: 0.7, dueDate: '2026-10-07', needsVerdict: false, overdue: false }] },
      staleCards: { count: 10, items: [{ taskId: 't1', name: 'Fix the gantt', projectId: 'b1', projectName: 'Aeon', columnName: 'Live', ageDays: 30 }] },
      sessions: { count: 2, items: [
        { id: 's1', engine: 'claude', goal: 'Refactor inbox', status: 'succeeded', repo: null, projectId: 'b2', taskId: 't9', spawnedAt: '2026-10-06T22:00:00.000Z', endedAt: null },
        { id: 's2', engine: 'codex', goal: 'Loose run', status: 'failed', repo: null, projectId: null, taskId: null, spawnedAt: '2026-10-06T23:00:00.000Z', endedAt: null },
      ] },
    }} />)
    expect(screen.getByText('Cockpit ships this week').closest('a')?.getAttribute('href')).toBe('/vorath')
    expect(screen.getByText('Fix the gantt').closest('a')?.getAttribute('href')).toBe('/project/b1')
    expect(screen.getByText('Refactor inbox').closest('a')?.getAttribute('href')).toBe('/project/b2')
    expect(screen.getByText('Loose run').closest('a')?.getAttribute('href')).toBe('/vorath')
    const stale = screen.getByRole('region', { name: 'Stale cards' })
    expect(within(stale).getByText('…and 9 more')).toBeTruthy()
  })
})
