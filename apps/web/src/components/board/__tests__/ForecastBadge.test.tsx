import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

const getCardForecasts = vi.fn()
vi.mock('@/lib/actions/card-forecast', () => ({ getCardForecasts: (...a: unknown[]) => getCardForecasts(...a) }))

import { ForecastBadge, formatLikely } from '../ForecastBadge'
import { TaskCardBadges } from '../TaskCardBadges'
import { useBoardStore } from '@/lib/store/boardStore'
import { useForecastStore, createForecastStore, FORECAST_REFRESH_MS } from '@/lib/store/forecastStore'
import type { CardForecast } from '@/lib/schedule/forecast'

const PROJECT = '11111111-1111-4111-8111-111111111111'

function forecast(over: Partial<CardForecast> = {}): CardForecast {
  return {
    taskId: 't1',
    forecastEnd: '2026-10-10T12:00:00.000Z',
    dueDate: '2026-10-11T00:00:00.000Z',
    status: 'at_risk',
    confidence: 'normal',
    reason: 'Based on how long cards sat in Live (about 3 days) over the last 30 days.',
    basis: { remainingHours: 72, columns: ['Live'], samples: 9, computedEnd: null, windowDays: 30 },
    ...over,
  }
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  getCardForecasts.mockReset()
  useForecastStore.setState({ projectId: null, byTaskId: {}, loadedAt: 0, inFlight: false, holders: 0 })
  useBoardStore.setState({ columns: [{ id: 'c1', projectId: PROJECT, name: 'Live', color: 'purple', orderIndex: 0 }] as never })
})

afterEach(() => {
  cleanup()
  useBoardStore.setState({ columns: [] })
})

describe('ForecastBadge', () => {
  it('loads the board once and shows "Likely <day>" with the reason as tooltip', async () => {
    getCardForecasts.mockResolvedValue({ forecasts: [forecast(), forecast({ taskId: 't2', status: 'late' })] })
    render(<><ForecastBadge taskId="t1" /><ForecastBadge taskId="t2" /><ForecastBadge taskId="t3" /></>)
    await flush()
    expect(getCardForecasts).toHaveBeenCalledTimes(1)
    expect(getCardForecasts).toHaveBeenCalledWith(PROJECT)
    const badges = screen.getAllByTestId('forecast-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0].textContent).toBe(formatLikely('2026-10-10T12:00:00.000Z'))
    expect(badges[0].textContent).toMatch(/^Likely \w{3} \d{1,2} \w{3}$/)
    expect(badges[0].getAttribute('title')).toMatch(/Based on how long cards sat in Live/)
    expect(badges[0].className).toMatch(/amber/)
    expect(badges[1].className).toMatch(/red/)
  })

  it('marks low-confidence forecasts in the tooltip', async () => {
    getCardForecasts.mockResolvedValue({ forecasts: [forecast({ confidence: 'low', status: 'on_track' })] })
    render(<ForecastBadge taskId="t1" />)
    await flush()
    expect(screen.getByTestId('forecast-badge').getAttribute('title')).toMatch(/\(low confidence\)$/)
  })

  it('renders nothing and calls no server on the demo board', async () => {
    useBoardStore.setState({ columns: [{ id: 'c1', projectId: 'demo-project', name: 'Live', color: 'purple', orderIndex: 0 }] as never })
    render(<ForecastBadge taskId="t1" />)
    await flush()
    expect(getCardForecasts).not.toHaveBeenCalled()
    expect(screen.queryByTestId('forecast-badge')).toBeNull()
  })

  it('mounts in the card badge row', async () => {
    getCardForecasts.mockResolvedValue({ forecasts: [forecast()] })
    const task = { id: 't1', name: 'Card', status: 'todo', color: 'purple', priority: 'medium' as const, labels: [], onTimeline: false }
    render(<TaskCardBadges task={task} />)
    await flush()
    expect(screen.getByTestId('forecast-badge')).toBeTruthy()
  })
})

describe('forecast store', () => {
  it('reloads on board open and every 5 minutes while held, and stops when released', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn(async () => ({ forecasts: [forecast()] }))
      const store = createForecastStore(loader)
      const release = store.getState().acquire(PROJECT)
      await vi.advanceTimersByTimeAsync(0)
      expect(loader).toHaveBeenCalledTimes(1)
      expect(store.getState().byTaskId.t1.status).toBe('at_risk')

      await vi.advanceTimersByTimeAsync(FORECAST_REFRESH_MS)
      expect(loader).toHaveBeenCalledTimes(2)

      release()
      await vi.advanceTimersByTimeAsync(FORECAST_REFRESH_MS * 2)
      expect(loader).toHaveBeenCalledTimes(2)

      const again = store.getState().acquire(PROJECT)
      await vi.advanceTimersByTimeAsync(0)
      expect(loader).toHaveBeenCalledTimes(3)
      again()
    } finally {
      vi.useRealTimers()
    }
  })
})
