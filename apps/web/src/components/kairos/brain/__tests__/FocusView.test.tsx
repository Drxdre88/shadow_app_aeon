/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FocusDominionView, FocusOverview } from '@/lib/actions/dominion-focus'

vi.mock('@/lib/actions/dominion-focus', () => ({ getFocusOverview: vi.fn(), setDominionPinnedAction: vi.fn() }))

import { getFocusOverview, setDominionPinnedAction } from '@/lib/actions/dominion-focus'
import { FocusView } from '../FocusView'

const NOW = '2026-10-05T12:00:00.000Z'
const SCORED = '2026-10-05T01:10:00.000Z'

function area(over: Partial<FocusDominionView>): FocusDominionView {
  return {
    id: 'd-x', name: 'Area', color: 'purple', activityScore: 0, lastActiveAt: null, activityScoredAt: SCORED,
    activity: null, focusState: 'active', pinned: false, dormant: false, ...over,
  }
}

const OVERVIEW: FocusOverview = {
  mode: 'observe',
  generatedAt: NOW,
  dominions: [
    area({
      id: 'd-1', name: 'KAIROS', activityScore: 40, lastActiveAt: '2026-10-02T09:00:00.000Z',
      activity: {
        windowDays: 14, scoredAt: SCORED, sessions: 9, cardsFinished: 4, notes: 2,
        boards: [{ id: 'b-1', name: 'AI Mission Control', score: 12 }, { id: 'b-2', name: 'Side board', score: 1 }],
        repos: [{ slug: 'shadow_app_aeon', score: 20 }, { slug: 'kairos-worker', score: 5 }],
      },
    }),
    area({ id: 'd-2', name: 'STP HQ', activityScore: 0, focusState: 'dormant', dormant: true, lastActiveAt: '2026-09-01T09:00:00.000Z' }),
    area({ id: 'd-3', name: 'Swarm', activityScore: 10, pinned: true }),
  ],
  unattributed: { scoredAt: SCORED, boards: [{ id: 'b-9', name: 'Loose ends', score: 3 }], repos: [{ slug: 'hydra', score: 7 }] },
}

beforeEach(() => {
  vi.mocked(getFocusOverview).mockResolvedValue(structuredClone(OVERVIEW))
  vi.mocked(setDominionPinnedAction).mockImplementation(async ({ dominionId, pinned }) => ({ dominionId, pinned, focusState: 'active' }))
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('FocusView', () => {
  it('shows the watch-only banner, ranked areas with state, recency and top work', async () => {
    render(<FocusView />)
    await screen.findByText('KAIROS')
    expect(screen.getByText(/Watch-only: this is where Vorath thinks your time went/)).toBeTruthy()
    expect(screen.getByText('Last active 3 days ago')).toBeTruthy()
    expect(screen.getByText('Dormant')).toBeTruthy()
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('shadow_app_aeon')).toBeTruthy()
    expect(screen.getByText('AI Mission Control')).toBeTruthy()
    expect(screen.getByText('kairos-worker')).toBeTruthy()
    expect(screen.queryByText('Side board')).toBeNull()
    expect(screen.getByRole('meter', { name: 'KAIROS activity' }).getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByRole('meter', { name: 'Swarm activity' }).getAttribute('aria-valuenow')).toBe('25')
  })

  it('lists work that belongs nowhere', async () => {
    render(<FocusView />)
    await screen.findByText('Work that belongs nowhere')
    expect(screen.getByText('hydra')).toBeTruthy()
    expect(screen.getByText('Loose ends')).toBeTruthy()
  })

  it('pins a dormant area and it wakes up', async () => {
    render(<FocusView />)
    const pin = await screen.findByRole('button', { name: 'Pin STP HQ' })
    fireEvent.click(pin)
    await waitFor(() => expect(setDominionPinnedAction).toHaveBeenCalledWith({ dominionId: 'd-2', pinned: true }))
    expect(await screen.findByRole('button', { name: 'Unpin STP HQ' })).toBeTruthy()
    expect(screen.queryByText('Dormant')).toBeNull()
  })

  it('reverts the pin and shows the error when the save fails', async () => {
    vi.mocked(setDominionPinnedAction).mockRejectedValueOnce(new Error('Area not found or unauthorized'))
    render(<FocusView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unpin Swarm' }))
    expect(await screen.findByText('Area not found or unauthorized')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unpin Swarm' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the first-run empty state when nothing has been scored', async () => {
    vi.mocked(getFocusOverview).mockResolvedValue({
      ...OVERVIEW,
      dominions: OVERVIEW.dominions.map((d) => ({ ...d, activityScoredAt: null })),
      unattributed: null,
    })
    render(<FocusView />)
    expect(await screen.findByText(/first nightly run at 01:10 UTC/)).toBeTruthy()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it.each([
    ['off', /Switched off — set/],
    ['on', /On: Vorath follows these areas/],
  ] as const)('shows the %s banner', async (mode, text) => {
    vi.mocked(getFocusOverview).mockResolvedValue({ ...OVERVIEW, mode })
    render(<FocusView />)
    expect(await screen.findByText(text)).toBeTruthy()
  })
})
