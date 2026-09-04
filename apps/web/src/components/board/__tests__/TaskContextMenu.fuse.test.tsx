/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// "Fuse N cards into this one" on the card menu: appears only when OTHER
// cards are selected (multi-select or the keyboard's single selection),
// counts the ones that are on this board, and hands the target + sources to
// the board's fusion lifecycle through FuseRequestContext.

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/actions/transfer', () => ({
  listProjectsForTransfer: vi.fn().mockResolvedValue([]),
  copyTaskToProject: vi.fn(),
  moveTaskToProject: vi.fn(),
}))
vi.mock('@/lib/actions/hangar', () => ({ spawnSessionFromCard: vi.fn() }))

import { TaskContextMenu } from '../TaskContextMenu'
import { FuseRequestContext } from '../fuseRequestContext'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'

const task = (id: string, projectId = 'p1'): BoardTask => ({
  id, projectId, name: `card ${id}`, columnId: 'col', status: 'todo', priority: 'medium', color: 'purple', labels: [], onTimeline: false, orderIndex: 0,
})

function renderMenu(requestFuse: ((targetId: string, sourceIds: string[]) => void) | null) {
  const onClose = vi.fn()
  const menu = <TaskContextMenu taskId="t" position={{ x: 10, y: 10 }} onClose={onClose} onSelectTask={vi.fn()} />
  render(requestFuse ? <FuseRequestContext.Provider value={requestFuse}>{menu}</FuseRequestContext.Provider> : menu)
  return { onClose }
}

beforeEach(() => {
  useBoardStore.setState({
    tasks: [task('t'), task('a'), task('b'), task('far', 'p2')],
    columns: [],
    selectedTaskIds: [],
    selectedTaskId: null,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaskContextMenu — Fuse N cards into this one', () => {
  it('is absent with nothing else selected, and when only this card is selected', async () => {
    renderMenu(vi.fn())
    expect(await screen.findByText('Select')).toBeTruthy()
    expect(screen.queryByTestId('fuse-cards')).toBeNull()
    cleanup()

    useBoardStore.setState({ selectedTaskIds: ['t'], selectedTaskId: 't' })
    renderMenu(vi.fn())
    expect(await screen.findByText('Select')).toBeTruthy()
    expect(screen.queryByTestId('fuse-cards')).toBeNull()
  })

  it('counts the other selected cards on this board — multi-select plus the keyboard selection — and requests the fusion', async () => {
    const requestFuse = vi.fn()
    useBoardStore.setState({ selectedTaskIds: ['a', 't', 'far', 'ghost'], selectedTaskId: 'b' })
    const { onClose } = renderMenu(requestFuse)

    const button = await screen.findByTestId('fuse-cards')
    expect(button.textContent).toContain('Fuse 3 cards into this one')
    expect(button.getAttribute('title')).toBe('Absorbs: card a, card b')

    fireEvent.click(button)
    expect(requestFuse).toHaveBeenCalledWith('t', ['a', 'b'])
    expect(onClose).toHaveBeenCalled()
  })

  it('is absent outside a board (no fusion lifecycle to hand the request to)', async () => {
    useBoardStore.setState({ selectedTaskIds: ['a'] })
    renderMenu(null)
    expect(await screen.findByText('Select')).toBeTruthy()
    expect(screen.queryByTestId('fuse-cards')).toBeNull()
  })
})
