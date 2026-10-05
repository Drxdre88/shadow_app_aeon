/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('@/lib/actions/kairos-brain', () => ({
  getKairosBrainStatus: vi.fn(),
  getKairosWatchedOverview: vi.fn(),
  setPaidBackup: vi.fn(),
  sendKairosTestMessage: vi.fn(),
}))
vi.mock('@/lib/actions/projects', () => ({ setProjectKairosFeed: vi.fn() }))
vi.mock('@/lib/actions/dominions', () => ({ addDominionRepoAction: vi.fn() }))

import { getKairosBrainStatus } from '@/lib/actions/kairos-brain'
import { KairosSidebarSection, resetKairosSetupBadgeCache } from '../KairosSidebarSection'

function status(brainLive: boolean): KairosBrainStatus {
  return {
    generatedAt: '2026-10-02T07:00:00.000Z',
    appUrl: 'https://aeon.example',
    mcpUrl: 'https://aeon.example/api/mcp',
    lastNight: { routine: 0, backup: 0, missed: 0 },
    backupKinds: [],
    kinds: [],
    routines: [
      { id: 'brain', lastClaimAt: brainLive ? '2026-10-02T05:40:00.000Z' : null, state: brainLive ? 'live' : 'silent' },
      { id: 'chat', lastClaimAt: null, state: 'off' },
    ],
    telegram: { routineFlagOn: false, routineConfigured: false },
    isAdmin: false,
    setup: { connectorUsedAt: '2026-10-01T20:00:00.000Z', sessions: { claude: null, codex: null, copilot: null }, voiceNoteAt: null, watchedBoards: 0, telegramConfigured: false },
  }
}

beforeEach(() => resetKairosSetupBadgeCache())
afterEach(() => { cleanup(); vi.mocked(getKairosBrainStatus).mockReset() })

describe('KairosSidebarSection', () => {
  it('has one Vorath setup button instead of Connect brain / Setup / Guide', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status(true))
    render(<KairosSidebarSection collapsed={false} />)
    expect(screen.getByRole('button', { name: /^Vorath setup/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Connect brain|^Setup$|^Guide$/ })).toBeNull()
  })

  it('badges the button with the required steps still missing', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status(false))
    render(<KairosSidebarSection collapsed={false} />)
    expect(await screen.findByRole('button', { name: 'Vorath setup — 1 required step left' })).toBeTruthy()
  })

  it('fetches once and reuses the answer across remounts', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status(false))
    const { unmount } = render(<KairosSidebarSection collapsed={false} />)
    await screen.findByRole('button', { name: /1 required step left/ })
    unmount()
    render(<KairosSidebarSection collapsed />)
    expect(screen.getByRole('button', { name: /1 required step left/ })).toBeTruthy()
    expect(getKairosBrainStatus).toHaveBeenCalledTimes(1)
  })

  it('opens the modal on the Setup tab', async () => {
    vi.mocked(getKairosBrainStatus).mockResolvedValue(status(true))
    render(<KairosSidebarSection collapsed={false} />)
    fireEvent.click(screen.getByRole('button', { name: /^Vorath setup/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Setup/ }).getAttribute('aria-selected')).toBe('true')
  })
})
