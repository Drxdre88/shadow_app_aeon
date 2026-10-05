/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'

vi.mock('@/lib/actions/kairos-brain', () => ({
  getKairosBrainStatus: vi.fn(),
  getKairosWatchedOverview: vi.fn(),
  setPaidBackup: vi.fn(),
  sendKairosTestMessage: vi.fn(),
}))
vi.mock('@/lib/actions/projects', () => ({ setProjectKairosFeed: vi.fn() }))
vi.mock('@/lib/actions/dominions', () => ({ addDominionRepoAction: vi.fn() }))

import { getKairosBrainStatus, getKairosWatchedOverview } from '@/lib/actions/kairos-brain'
import { ConnectKairosModal } from '../ConnectKairosModal'
import { cronToLocal } from '../brainTime'

function status(overrides: Partial<KairosBrainStatus> = {}): KairosBrainStatus {
  return {
    generatedAt: '2026-10-02T07:00:00.000Z',
    appUrl: 'https://aeon.example',
    mcpUrl: 'https://aeon.example/api/mcp',
    lastNight: { routine: 11, backup: 2, missed: 1 },
    backupKinds: ['cortex', 'ask_mine'],
    kinds: [{ kind: 'aether', lastAt: '2026-10-02T03:40:00.000Z', lastAnsweredBy: 'routine', week: { routine: 7, backup: 0, missed: 0 } }],
    routines: [
      { id: 'brain', lastClaimAt: '2026-10-02T05:40:00.000Z', state: 'live' },
      { id: 'chat', lastClaimAt: null, state: 'off' },
    ],
    telegram: { routineFlagOn: false, routineConfigured: false },
    isAdmin: false,
    ...overrides,
  }
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

afterEach(() => { cleanup(); vi.mocked(getKairosBrainStatus).mockReset() })

describe('ConnectKairosModal', () => {
  it('opens on Setup with exactly five tabs — no separate Connect, Routines, Voice notes or Chat tabs', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    expect(await screen.findByText(/required done|Vorath is set up/)).toBeTruthy()
    const names = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(names).toEqual(['Setup', 'Health', 'Brain map', 'Watched', 'How it works'])
    expect(tab(/Setup/).getAttribute('aria-selected')).toBe('true')
  })

  it('Health shows last night and names the jobs that fell back to the backup', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} defaultView="health" />)
    expect(await screen.findByText('11 on Max')).toBeTruthy()
    expect(screen.getByText('2 on backup')).toBeTruthy()
    expect(screen.getByText('Area summaries')).toBeTruthy()
    expect(screen.getByText('Question of the day')).toBeTruthy()
  })

  it('opens the brain map and shows a 7-day record', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    await screen.findByText(/required done|Vorath is set up/)
    fireEvent.click(tab(/Brain map/))
    expect(await screen.findByText('7/7 on Max')).toBeTruthy()
  })

  it('opens Watched from the switcher', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    vi.mocked(getKairosWatchedOverview).mockResolvedValue({
      projects: [{ id: 'p-1', name: 'AS Sprint', feed: 'daily', areaName: null }],
      areas: [],
      unmappedRepos: [],
    })
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    await screen.findByText(/required done|Vorath is set up/)
    fireEvent.click(tab(/Watched/))
    expect(await screen.findByText('AS Sprint')).toBeTruthy()
  })

  it('How it works is a short reference that links into the brain map', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} defaultView="guide" />)
    expect(await screen.findByText('The 06:00 message')).toBeTruthy()
    expect(screen.getByText('Paid backup')).toBeTruthy()
    expect(screen.queryByText(/02:30|BYOK|Will inbox/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /See every job on the brain map/ }))
    await waitFor(() => expect(tab(/Brain map/).getAttribute('aria-selected')).toBe('true'))
  })

  it('reports each fresh status to the caller', async () => {
    const s = status()
    vi.mocked(getKairosBrainStatus).mockResolvedValue(s)
    const onStatus = vi.fn()
    render(<ConnectKairosModal isOpen onClose={() => {}} onStatus={onStatus} />)
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(s))
  })

  it('shows a retryable error when the status call fails', async () => {
    vi.mocked(getKairosBrainStatus).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Try again'))
    expect(await screen.findByText(/required done|Vorath is set up/)).toBeTruthy()
  })
})

describe('cronToLocal', () => {
  it('translates an hourly UTC range', () => {
    expect(cronToLocal('40 1-6 * * *', '2026-10-02T07:00:00.000Z')).toMatch(/^Hourly \d\d:40–\d\d:40 your time$/)
  })
  it('gives up on cron it cannot read', () => {
    expect(cronToLocal('*/5 * * * *', '2026-10-02T07:00:00.000Z')).toBeNull()
  })
})
