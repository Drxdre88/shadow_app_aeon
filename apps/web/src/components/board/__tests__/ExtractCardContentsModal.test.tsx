/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/actions/checklist', () => ({ getChecklistItems: vi.fn() }))

import { getChecklistItems } from '@/lib/actions/checklist'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { ExtractCardContentsModal } from '../ExtractCardContentsModal'

const task: BoardTask = {
  id: 'card', projectId: 'project', name: 'A <card>', description: 'First line\nSecond line',
  columnId: 'column', status: 'todo', priority: 'urgent', color: 'purple', labels: ['label'], onTimeline: false, orderIndex: 0,
}
type ChecklistItem = Awaited<ReturnType<typeof getChecklistItems>>[number]
const checklistItem = (groupName: string, title: string, orderIndex: number): ChecklistItem => ({
  id: `${groupName}-${orderIndex}`, taskId: 'card', title, completed: false, state: 'unchecked', status: null,
  groupName, startDate: null, endDate: null, orderIndex, createdAt: new Date(),
})

beforeEach(() => {
  useBoardStore.setState({ tasks: [task], labels: [{ id: 'label', projectId: 'project', name: 'Release', color: '#fff' }] })
  useThemeStore.setState({ priorities: [{ id: 'urgent', name: 'Critical', color: '#f00' }] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ExtractCardContentsModal', () => {
  it('waits for all checklists, then shows selectable complete contents and copies rich text', async () => {
    let resolveItems!: (items: ChecklistItem[]) => void
    vi.mocked(getChecklistItems).mockReturnValue(new Promise((resolve) => { resolveItems = resolve }) as ReturnType<typeof getChecklistItems>)
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText: vi.fn() } })
    class ClipboardItemStub { constructor(public data: Record<string, Blob>) {} }
    vi.stubGlobal('ClipboardItem', ClipboardItemStub)

    const onClose = vi.fn()
    render(<ExtractCardContentsModal taskId="card" onClose={onClose} />)
    expect(screen.getByRole('status').textContent).toContain('Loading complete card contents')
    expect(screen.getByRole('button', { name: 'Copy card contents' }).hasAttribute('disabled')).toBe(true)
    resolveItems([
      { ...checklistItem('Alpha', 'Step one', 0), state: 'checked', completed: true },
      { ...checklistItem('Beta', 'Step two', 1), state: 'crossed' },
    ])
    await screen.findByText('Step two (Not doing)')

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'First line\nSecond line')).toBeTruthy()
    expect(screen.getByText('Critical')).toBeTruthy()
    expect(screen.getByText('Release')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Step one (Done)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy card contents' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const item = write.mock.calls[0][0][0] as ClipboardItemStub
    expect(Object.keys(item.data)).toEqual(['text/plain', 'text/html'])
    expect(screen.getByText('Copied to clipboard')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('falls back to plain text when rich clipboard write fails', async () => {
    vi.mocked(getChecklistItems).mockResolvedValue([])
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn().mockRejectedValue(new Error('blocked')), writeText } })
    vi.stubGlobal('ClipboardItem', class { constructor(_data: Record<string, Blob>) {} })
    render(<ExtractCardContentsModal taskId="card" onClose={vi.fn()} />)
    await screen.findByText('Critical')
    fireEvent.click(screen.getByRole('button', { name: 'Copy card contents' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Priority:\nCritical')))
    expect(screen.getByText('Copied to clipboard')).toBeTruthy()
  })

  it('reports checklist loading and clipboard failures without offering an incomplete copy', async () => {
    vi.mocked(getChecklistItems).mockRejectedValue(new Error('offline'))
    render(<ExtractCardContentsModal taskId="card" onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load the complete checklist. Try again.')
    expect(screen.getByRole('button', { name: 'Copy card contents' }).hasAttribute('disabled')).toBe(true)
    cleanup()

    vi.mocked(getChecklistItems).mockResolvedValue([])
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    render(<ExtractCardContentsModal taskId="card" onClose={vi.fn()} />)
    await screen.findByText('Critical')
    fireEvent.click(screen.getByRole('button', { name: 'Copy card contents' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Copy was blocked. Select the text above and copy it manually.')
  })
})
