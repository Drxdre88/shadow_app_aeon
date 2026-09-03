/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Render contract for the hand-rolled SVG charts: accessible image + hidden
// summary, a tooltip on hover/focus, intentional empty states, and a fully
// drawn static frame when Smooth UI Renders is off.

import { TrophyCompletionChart } from '../TrophyCompletionChart'
import { TrophyCycleTimeChart } from '../TrophyCycleTimeChart'
import { TrophyRhythmHeatmap } from '../TrophyRhythmHeatmap'
import { useThemeStore } from '@/stores/themeStore'
import type { TrophyDatum } from '../trophy-stats'

function datum(completedAt: Date, daysTaken: number | null = 4): TrophyDatum {
  return { completedAt, archivedAt: completedAt, priority: 'medium', daysTaken, labelSnapshot: [] }
}

const NOW = new Date()
const TASKS: TrophyDatum[] = [
  datum(NOW, 0),
  datum(new Date(NOW.getTime() - 86_400_000), 2),
  datum(new Date(NOW.getTime() - 2 * 86_400_000), 9),
  datum(new Date(NOW.getTime() - 9 * 86_400_000), 40),
]

beforeEach(() => {
  useThemeStore.setState({ smoothUiRenders: false })
})

afterEach(() => {
  cleanup()
})

describe('TrophyCompletionChart', () => {
  it('draws bars, a trend line and an accessible summary', () => {
    const { container } = render(<TrophyCompletionChart tasks={TASKS} />)
    const svg = container.querySelector('svg[role="img"]')!
    expect(svg.getAttribute('aria-label')).toMatch(/4 trophies/)
    const bars = [...svg.querySelectorAll('rect[fill^="url"]')]
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every((b) => parseFloat(b.getAttribute('height') ?? '0') > 0)).toBe(true)
    expect(bars.every((b) => parseFloat(b.getAttribute('y') ?? '-1') >= 0)).toBe(true)
    expect(svg.querySelector('path[d^="M"]')).toBeTruthy()
    expect(container.querySelector('.sr-only')!.textContent).toMatch(/4 trophies/)
  })

  it('shows a tooltip for the hovered period and switches granularity', () => {
    const { container } = render(<TrophyCompletionChart tasks={TASKS} />)
    const hit = container.querySelector('rect[tabindex="0"]')!
    fireEvent.pointerEnter(hit)
    expect(screen.getByRole('tooltip').textContent).toMatch(/troph/)
    fireEvent.pointerLeave(hit)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Days' }))
    expect(container.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toMatch(/56 days/)
  })

  it('renders an intentional empty state', () => {
    render(<TrophyCompletionChart tasks={[]} />)
    expect(screen.getByText(/Nothing landed in this window yet/)).toBeTruthy()
  })
})

describe('TrophyCycleTimeChart', () => {
  it('buckets lead times and reports median / p90', () => {
    const { container } = render(<TrophyCycleTimeChart tasks={TASKS} />)
    expect(container.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toMatch(/median 5\.5d/)
    expect(screen.getByText('5.5d')).toBeTruthy()
    expect(container.querySelectorAll('rect[fill^="url"]')).toHaveLength(4)
  })

  it('renders an intentional empty state without recorded lead times', () => {
    render(<TrophyCycleTimeChart tasks={[datum(NOW, null)]} />)
    expect(screen.getByText(/Cycle time appears once/)).toBeTruthy()
  })
})

describe('TrophyRhythmHeatmap', () => {
  it('draws a 7x24 grid and highlights the peak', () => {
    const { container } = render(<TrophyRhythmHeatmap tasks={TASKS} />)
    const svg = container.querySelector('svg[role="img"]')!
    expect(svg.querySelectorAll('rect[rx="2.5"]')).toHaveLength(7 * 24)
    expect(screen.getByText('peak').textContent).toMatch(/peak/)
    fireEvent.pointerEnter(svg.querySelector('rect[rx="2.5"]')!)
    expect(screen.getByRole('tooltip').textContent).toMatch(/Mon 12am/)
  })

  it('renders an intentional empty state', () => {
    render(<TrophyRhythmHeatmap tasks={[]} />)
    expect(screen.getByText(/finishing rhythm shows up here/)).toBeTruthy()
  })

  it('survives trophies whose dates cannot be parsed instead of taking the room down', () => {
    const undated: TrophyDatum[] = [
      { completedAt: 'not a date', archivedAt: 'still not a date', priority: 'low', daysTaken: null, labelSnapshot: [] },
      { completedAt: null, archivedAt: 'nope', priority: 'low', daysTaken: null, labelSnapshot: [] },
    ]
    const { container } = render(<TrophyRhythmHeatmap tasks={undated} />)
    expect(screen.getByText(/no usable completion dates/)).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeNull()
    expect(container.querySelector('.sr-only')!.textContent).toMatch(/2 trophies, none with a usable completion date/)
  })
})
