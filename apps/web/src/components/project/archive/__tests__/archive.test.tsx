/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('@/lib/actions/project-archive', () => ({
  getProjectArchiveSetting: vi.fn(),
  setProjectArchived: vi.fn(),
  getArchivedProjects: vi.fn(),
}))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

import { getArchivedProjects, getProjectArchiveSetting, setProjectArchived } from '@/lib/actions/project-archive'
import { toast } from '@/components/ui/Toast'
import { ArchiveBoardToggle } from '../ArchiveBoardToggle'
import { ArchivedBoardsButton } from '../ArchivedBoardsButton'
import { ArchivedBoardBanner } from '../ArchivedBoardBanner'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('ArchiveBoardToggle', () => {
  it('is locked with the reason for anyone but the board creator', async () => {
    vi.mocked(getProjectArchiveSetting).mockResolvedValue({ archived: false, archivedAt: null, canToggle: false })
    render(<ArchiveBoardToggle projectId="p-1" projectName="Apollo" isOpen />)
    const button = await screen.findByRole('button', { name: /Archive board/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Only the person who created this board/)).toBeTruthy()
  })

  it('asks first, then archives and sends the creator to the dashboard', async () => {
    vi.mocked(getProjectArchiveSetting).mockResolvedValue({ archived: false, archivedAt: null, canToggle: true })
    vi.mocked(setProjectArchived).mockResolvedValue({ projectId: 'p-1', archived: true })
    const onArchived = vi.fn()
    render(<ArchiveBoardToggle projectId="p-1" projectName="Apollo" isOpen onArchived={onArchived} />)
    fireEvent.click(await screen.findByRole('button', { name: /Archive board/ }))
    expect(setProjectArchived).not.toHaveBeenCalled()
    expect(screen.getByText('Archive "Apollo"?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(setProjectArchived).toHaveBeenCalledWith('p-1', true))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    expect(onArchived).toHaveBeenCalled()
  })

  it('rolls back and explains when the server refuses', async () => {
    vi.mocked(getProjectArchiveSetting).mockResolvedValue({ archived: true, archivedAt: null, canToggle: true })
    vi.mocked(setProjectArchived).mockRejectedValue(new Error('Only the person who created this board can archive it'))
    render(<ArchiveBoardToggle projectId="p-1" projectName="Apollo" isOpen />)
    const button = await screen.findByRole('button', { name: /Archive board/ })
    fireEvent.click(button)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Only the person who created this board can archive it'))
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ArchivedBoardsButton', () => {
  it('stays out of the footer while nothing is archived', async () => {
    vi.mocked(getArchivedProjects).mockResolvedValue([])
    const { container } = render(<ArchivedBoardsButton />)
    await waitFor(() => expect(getArchivedProjects).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('lists archived boards and restores one', async () => {
    vi.mocked(getArchivedProjects).mockResolvedValue([
      { id: 'p-1', name: 'Apollo', archivedAt: '2026-10-01T10:00:00.000Z' },
      { id: 'p-2', name: 'Gemini', archivedAt: null },
    ])
    vi.mocked(setProjectArchived).mockResolvedValue({ projectId: 'p-2', archived: false })
    render(<ArchivedBoardsButton />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archived boards (2)' }))
    expect(await screen.findByText('Apollo')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Open/ })[1].getAttribute('href')).toBe('/project/p-2')
    fireEvent.click(screen.getByRole('button', { name: 'Restore Gemini' }))
    await waitFor(() => expect(setProjectArchived).toHaveBeenCalledWith('p-2', false))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})

describe('ArchivedBoardBanner', () => {
  it('renders nothing on a live board', () => {
    const { container } = render(<ArchivedBoardBanner projectId="p-1" initiallyArchived={false} />)
    expect(container.innerHTML).toBe('')
    expect(getProjectArchiveSetting).not.toHaveBeenCalled()
  })

  it('offers Restore only to the creator', async () => {
    vi.mocked(getProjectArchiveSetting).mockResolvedValue({ archived: true, archivedAt: null, canToggle: false })
    render(<ArchivedBoardBanner projectId="p-1" initiallyArchived />)
    expect(screen.getByText(/This board is archived/)).toBeTruthy()
    await waitFor(() => expect(getProjectArchiveSetting).toHaveBeenCalledWith('p-1'))
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull()
  })

  it('restores in place for the creator', async () => {
    vi.mocked(getProjectArchiveSetting)
      .mockResolvedValueOnce({ archived: true, archivedAt: null, canToggle: true })
      .mockResolvedValue({ archived: false, archivedAt: null, canToggle: true })
    vi.mocked(setProjectArchived).mockResolvedValue({ projectId: 'p-1', archived: false })
    const { container } = render(<ArchivedBoardBanner projectId="p-1" initiallyArchived />)
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }))
    await waitFor(() => expect(setProjectArchived).toHaveBeenCalledWith('p-1', false))
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(refresh).toHaveBeenCalled()
  })
})
