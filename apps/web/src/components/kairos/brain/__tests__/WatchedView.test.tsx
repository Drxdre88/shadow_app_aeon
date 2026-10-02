/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { KairosWatchedOverview } from '@/lib/actions/kairos-brain'

vi.mock('@/lib/actions/kairos-brain', () => ({ getKairosWatchedOverview: vi.fn() }))
vi.mock('@/lib/actions/projects', () => ({ setProjectKairosFeed: vi.fn() }))
vi.mock('@/lib/actions/dominions', () => ({ addDominionRepoAction: vi.fn() }))

import { getKairosWatchedOverview } from '@/lib/actions/kairos-brain'
import { setProjectKairosFeed } from '@/lib/actions/projects'
import { addDominionRepoAction } from '@/lib/actions/dominions'
import { WatchedView } from '../WatchedView'

const OVERVIEW: KairosWatchedOverview = {
  projects: [
    { id: 'p-as', name: 'AS Sprint', feed: 'daily', areaName: 'KAIROS' },
    { id: 'p-stp', name: 'STP Sprint', feed: 'weekly', areaName: null },
    { id: 'p-x', name: 'Side quest', feed: null, areaName: null },
  ],
  areas: [
    { id: 'd-1', name: 'KAIROS', color: 'purple', repos: ['shadow_app_aeon'] },
    { id: 'd-2', name: 'Swarm', color: 'blue', repos: [] },
  ],
  unmappedRepos: [{ repo: 'hydra', captures: 4, lastAt: '2026-10-01T08:00:00.000Z' }],
}

function row(name: string) {
  return screen.getByRole('tablist', { name: `Kairos watch for ${name}` })
}

beforeEach(() => {
  vi.mocked(getKairosWatchedOverview).mockResolvedValue(structuredClone(OVERVIEW))
  vi.mocked(setProjectKairosFeed).mockImplementation(async (projectId, feed) => ({ projectId, feed }))
  vi.mocked(addDominionRepoAction).mockResolvedValue(null as never)
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('WatchedView', () => {
  it("shows each board's watch mode, area repos and unmapped session repos", async () => {
    render(<WatchedView />)
    await screen.findByText('AS Sprint')
    expect(within(row('AS Sprint')).getByRole('tab', { name: 'Daily' }).getAttribute('aria-selected')).toBe('true')
    expect(within(row('STP Sprint')).getByRole('tab', { name: 'Weekly' }).getAttribute('aria-selected')).toBe('true')
    expect(within(row('Side quest')).getByRole('tab', { name: 'Off' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('shadow_app_aeon')).toBeTruthy()
    expect(screen.getByText('No repos')).toBeTruthy()
    expect(screen.getByText('hydra')).toBeTruthy()
    expect(screen.getByText(/belong to no area/)).toBeTruthy()
  })

  it('calls the server action when a picker changes, null for Off', async () => {
    render(<WatchedView />)
    await screen.findByText('Side quest')
    fireEvent.click(within(row('Side quest')).getByRole('tab', { name: 'Daily' }))
    await waitFor(() => expect(setProjectKairosFeed).toHaveBeenCalledWith('p-x', 'daily'))
    expect(within(row('Side quest')).getByRole('tab', { name: 'Daily' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(within(row('AS Sprint')).getByRole('tab', { name: 'Off' }))
    await waitFor(() => expect(setProjectKairosFeed).toHaveBeenCalledWith('p-as', null))
  })

  it('reverts the picker and shows the error when the save fails', async () => {
    vi.mocked(setProjectKairosFeed).mockRejectedValueOnce(new Error('Project not found or unauthorized'))
    render(<WatchedView />)
    await screen.findByText('STP Sprint')
    fireEvent.click(within(row('STP Sprint')).getByRole('tab', { name: 'Off' }))
    expect(await screen.findByText('Project not found or unauthorized')).toBeTruthy()
    expect(within(row('STP Sprint')).getByRole('tab', { name: 'Weekly' }).getAttribute('aria-selected')).toBe('true')
  })

  it('assigns an unmapped repo to an area and reloads', async () => {
    render(<WatchedView />)
    const select = await screen.findByLabelText('Assign hydra to an area')
    fireEvent.change(select, { target: { value: 'd-2' } })
    await waitFor(() => expect(addDominionRepoAction).toHaveBeenCalledWith({ dominionId: 'd-2', repoSlug: 'hydra' }))
    await waitFor(() => expect(getKairosWatchedOverview).toHaveBeenCalledTimes(2))
  })
})
