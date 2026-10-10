/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { vorathSession } from '@/hooks/testing/vorathSession'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('@/lib/actions/kairos-brain', () => ({
  getKairosBrainStatus: vi.fn(() => new Promise(() => {})),
  getKairosWatchedOverview: vi.fn(),
  setPaidBackup: vi.fn(),
  sendKairosTestMessage: vi.fn(),
}))
vi.mock('@/lib/actions/projects', () => ({ setProjectKairosFeed: vi.fn() }))
vi.mock('@/lib/actions/dominions', () => ({ addDominionRepoAction: vi.fn() }))
vi.mock('@/lib/actions/dominion-focus', () => ({ getFocusOverview: vi.fn(() => new Promise(() => {})), setDominionPinnedAction: vi.fn() }))

import { getKairosBrainStatus } from '@/lib/actions/kairos-brain'
import { KairosSidebarSection, resetKairosSetupBadgeCache } from '../KairosSidebarSection'

afterEach(() => { cleanup(); resetKairosSetupBadgeCache(); vi.mocked(getKairosBrainStatus).mockClear() })

describe('KairosSidebarSection access', () => {
  it('shows the Vorath pill and setup to the owner', () => {
    render(<KairosSidebarSection collapsed={false} />, { wrapper: vorathSession('owner') })
    expect(screen.getByRole('link', { name: 'Open Vorath' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Vorath setup/ })).toBeTruthy()
  })

  it('renders nothing for a beta tester and never asks for brain status', () => {
    const { container } = render(<KairosSidebarSection collapsed={false} />, { wrapper: vorathSession('tester') })
    expect(container.innerHTML).toBe('')
    expect(getKairosBrainStatus).not.toHaveBeenCalled()
  })
})
