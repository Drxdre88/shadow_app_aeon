/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const getPrivateChangelog = vi.fn()
vi.mock('@/lib/actions/changelog-private', () => ({ getPrivateChangelog: () => getPrivateChangelog() }))
vi.mock('@/lib/changelog', () => ({ CHANGELOG_MD: '# Changelog\n\n## [1.0.0] — 2026-10-10\n\n### Added · `BOARD`\n- public board line' }))

import { ChangelogModal } from './ChangelogModal'
import { APP_VERSION } from '@/lib/version'

const PRIVATE_TERMS = /\b(Vorath|Kairos|Dominions?|aether|Telegram|thinking jobs?|Hangar|AI DONE|second brain|memories)\b/i

beforeEach(() => {
  getPrivateChangelog.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ChangelogModal', () => {
  it('shows only the public log, with no tabs, when the private log is withheld', async () => {
    getPrivateChangelog.mockResolvedValue(null)
    render(<ChangelogModal isOpen onClose={() => {}} />)
    await waitFor(() => expect(getPrivateChangelog).toHaveBeenCalledTimes(1))
    expect(screen.getByText(`CURRENT BUILD · v${APP_VERSION}`)).toBeTruthy()
    expect(screen.getByText('public board line')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Vorath' })).toBeNull()
  })

  it('adds a Vorath tab for the owner and switches to the private log', async () => {
    getPrivateChangelog.mockResolvedValue({
      version: '9.9.0',
      markdown: '# Vorath Changelog\n\n## [9.9.0] — 2026-10-10\n\n#### Secret section\n- owner-only line',
    })
    render(<ChangelogModal isOpen onClose={() => {}} />)
    const vorathTab = await screen.findByRole('tab', { name: 'Vorath' })
    expect(screen.getByRole('tab', { name: 'Aeon' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('owner-only line')).toBeNull()

    fireEvent.click(vorathTab)
    expect(vorathTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('owner-only line')).toBeTruthy()
    expect(screen.getByText('Secret section')).toBeTruthy()
    expect(screen.getByText('VORATH · v9.9.0')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Aeon' }))
    expect(screen.queryByText('owner-only line')).toBeNull()
    expect(screen.getByText(`CURRENT BUILD · v${APP_VERSION}`)).toBeTruthy()
  })

  it('stays on the public log when the private fetch fails', async () => {
    getPrivateChangelog.mockRejectedValue(new Error('network'))
    render(<ChangelogModal isOpen onClose={() => {}} />)
    await waitFor(() => expect(getPrivateChangelog).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('does not ask for the private log while closed', () => {
    render(<ChangelogModal isOpen={false} onClose={() => {}} />)
    expect(getPrivateChangelog).not.toHaveBeenCalled()
  })
})

describe('public changelog data', () => {
  it('carries no Vorath content', async () => {
    const { CHANGELOG_MD } = await vi.importActual<typeof import('@/lib/changelog')>('@/lib/changelog')
    expect(CHANGELOG_MD).toContain('## [')
    expect(CHANGELOG_MD).not.toMatch(PRIVATE_TERMS)
  })
})
