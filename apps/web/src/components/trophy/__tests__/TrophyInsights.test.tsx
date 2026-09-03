/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

// Locks two trophy-insights fixes:
//  1. the bar gradient is per-instance — a document-global id meant a second
//     chart on the page silently painted with the first chart's gradient;
//  2. a user-defined priority level gets its own row instead of being folded
//     into Medium by the aggregation.

import { TrophyInsights } from '../TrophyInsights'
import { useThemeStore } from '@/stores/themeStore'
import type { TrophyDatum } from '../trophy-stats'

const CUSTOM_PRIORITIES = [
  { id: 'low', name: 'low', color: '#86efac' },
  { id: 'medium', name: 'medium', color: '#fde68a' },
  { id: 'high', name: 'high', color: '#fb923c' },
  { id: 'urgent', name: 'urgent', color: '#ef4444' },
  { id: 'p0', name: 'Drop everything', color: '#a855f7' },
]

function datum(priority: string | null): TrophyDatum {
  return {
    completedAt: new Date(),
    archivedAt: new Date(),
    priority,
    labelSnapshot: [],
    columnName: 'Done',
  }
}

beforeEach(() => {
  useThemeStore.setState({ priorities: CUSTOM_PRIORITIES })
})

afterEach(() => {
  cleanup()
})

describe('TrophyInsights bar gradient', () => {
  it('gives each chart instance its own gradient id', () => {
    const { container } = render(
      <>
        <TrophyInsights tasks={[datum('medium')]} />
        <TrophyInsights tasks={[datum('medium')]} />
      </>
    )

    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.getAttribute('id'))
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id && /^[A-Za-z0-9_-]+$/.test(id))).toBe(true)
  })

  it('points every bar at the gradient defined in its OWN svg', () => {
    const { container } = render(
      <>
        <TrophyInsights tasks={[datum('medium')]} />
        <TrophyInsights tasks={[datum('medium')]} />
      </>
    )

    const svgs = [...container.querySelectorAll('svg[role="img"]')].filter((svg) => svg.querySelector('linearGradient'))
    expect(svgs.length).toBeGreaterThanOrEqual(2)

    for (const svg of svgs) {
      const ownId = svg.querySelector('linearGradient')!.getAttribute('id')
      const bars = [...svg.querySelectorAll('rect[fill^="url"]')]
      expect(bars.length).toBeGreaterThan(0)
      for (const bar of bars) {
        expect(bar.getAttribute('fill')).toBe(`url(#${ownId})`)
      }
    }
  })
})

describe('TrophyInsights priority breakdown', () => {
  it('shows a custom priority level under its own resolved name', () => {
    render(<TrophyInsights tasks={[datum('p0'), datum('p0'), datum('medium')]} />)

    const panel = screen.getByRole('region', { name: 'By priority' })
    // The old aggregation collapsed 'p0' to 'medium', so this row did not exist.
    expect(within(panel).getByText('Drop everything')).toBeTruthy()
    expect(within(panel).getByText('medium')).toBeTruthy()
  })

  it('labels trophies with no priority recorded instead of counting them as Medium', () => {
    render(<TrophyInsights tasks={[datum(null), datum('medium')]} />)

    const panel = screen.getByRole('region', { name: 'By priority' })
    expect(within(panel).getByText('No priority')).toBeTruthy()
    expect(within(panel).getByText('medium')).toBeTruthy()
  })
})
