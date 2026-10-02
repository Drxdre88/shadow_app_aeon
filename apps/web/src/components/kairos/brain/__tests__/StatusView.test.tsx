/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'

vi.mock('@/lib/actions/kairos-brain', () => ({ setPaidBackup: vi.fn() }))

import { setPaidBackup } from '@/lib/actions/kairos-brain'
import { StatusView } from '../StatusView'

function status(overrides: Partial<KairosBrainStatus> = {}): KairosBrainStatus {
  return {
    generatedAt: '2026-10-02T07:00:00.000Z',
    appUrl: 'https://aeon.example',
    mcpUrl: 'https://aeon.example/api/mcp',
    lastNight: { routine: 11, backup: 2, missed: 1 },
    backupKinds: [],
    kinds: [],
    routines: [
      { id: 'brain', lastClaimAt: '2026-10-02T05:40:00.000Z', state: 'live' },
      { id: 'chat', lastClaimAt: null, state: 'off' },
    ],
    telegram: { routineFlagOn: false, routineConfigured: false },
    isAdmin: false,
    paidBackup: { enabled: true, paidCallsLast7d: 4 },
    ...overrides,
  }
}

const renderView = (s: KairosBrainStatus) =>
  render(<StatusView status={s} refreshing={false} onRefresh={() => {}} onNavigate={() => {}} />)

afterEach(() => { cleanup(); vi.mocked(setPaidBackup).mockReset() })

describe('StatusView — Paid backup switch', () => {
  it('on: explains the paid cover with the 7-day count', () => {
    renderView(status())
    const sw = screen.getByRole('switch', { name: 'Paid backup' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/Kairos pays your API key to cover it \(4 times in the last 7 days\)/)).toBeTruthy()
  })

  it('off: says the key is never used', () => {
    renderView(status({ paidBackup: { enabled: false, paidCallsLast7d: 0 } }))
    expect(screen.getByRole('switch', { name: 'Paid backup' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/Never uses your API key\. A missed job waits for the next run; the 06:00 message falls back to plain text\./)).toBeTruthy()
  })

  it('flips optimistically and saves', async () => {
    let resolve!: (v: { enabled: boolean }) => void
    vi.mocked(setPaidBackup).mockReturnValue(new Promise((r) => { resolve = r }))
    renderView(status())
    const sw = screen.getByRole('switch', { name: 'Paid backup' })
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(setPaidBackup).toHaveBeenCalledWith(false)
    resolve({ enabled: false })
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false))
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('reverts and says so when the save fails', async () => {
    vi.mocked(setPaidBackup).mockRejectedValue(new Error('boom'))
    renderView(status())
    const sw = screen.getByRole('switch', { name: 'Paid backup' })
    fireEvent.click(sw)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('hides the row when the status carries no paid-backup info', () => {
    renderView(status({ paidBackup: undefined }))
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
