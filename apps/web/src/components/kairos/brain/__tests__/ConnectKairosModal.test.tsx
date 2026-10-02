/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'

vi.mock('@/lib/actions/kairos-brain', () => ({ getKairosBrainStatus: vi.fn(), getKairosWatchedOverview: vi.fn() }))
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

afterEach(() => { cleanup(); vi.mocked(getKairosBrainStatus).mockReset() })

describe('ConnectKairosModal', () => {
  it('shows last night and names the jobs that fell back to the backup', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    expect(await screen.findByText('11 on Max')).toBeTruthy()
    expect(screen.getByText('2 on backup')).toBeTruthy()
    expect(screen.getByText('Area summaries')).toBeTruthy()
    expect(screen.getByText('Question of the day')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Telegram/ })).toBeNull()
  })

  it('opens the brain map and shows a 7-day record', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    await screen.findByText('11 on Max')
    fireEvent.click(screen.getByRole('tab', { name: /Brain map/ }))
    expect(await screen.findByText('7/7 on Max')).toBeTruthy()
  })

  it('shows the Telegram view only to admins, with placeholder env lines', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status({ isAdmin: true }))
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: /Telegram/ }))
    expect(await screen.findByText(/ROUTINE_CHAT_TOKEN=sk-ant-oat01-…/)).toBeTruthy()
  })

  it('opens the Watched and Voice notes views from the switcher', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status())
    vi.mocked(getKairosWatchedOverview).mockResolvedValue({
      projects: [{ id: 'p-1', name: 'AS Sprint', feed: 'daily', areaName: null }],
      areas: [],
      unmappedRepos: [],
    })
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    await screen.findByText('11 on Max')
    fireEvent.click(screen.getByRole('tab', { name: /Watched/ }))
    expect(await screen.findByText('AS Sprint')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Voice notes/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /Voice notes/ }).getAttribute('aria-selected')).toBe('true'))
    await waitFor(() => expect(screen.queryByText('AS Sprint')).toBeNull())
  })

  it('shows a retryable error when the status call fails', async () => {
    vi.mocked(getKairosBrainStatus).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(status())
    render(<ConnectKairosModal isOpen onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Try again'))
    expect(await screen.findByText('11 on Max')).toBeTruthy()
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
