/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

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
import { spawnSessionFromCard } from '@/lib/actions/hangar'

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
  vi.mocked(spawnSessionFromCard).mockResolvedValue({ id: 'session-new' } as never)
  useBoardStore.setState({
    tasks: [task('t'), task('a'), task('b'), task('far', 'p2')],
    columns: [],
    selectedTaskIds: [],
    selectedTaskId: null,
    isDirty: false,
    lastMutatedAt: 123,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaskContextMenu — Agent mission', () => {
  it('offers setup instead of launch for an incomplete mission', async () => {
    useBoardStore.setState({ tasks: [{ ...task('t'), metadata: { hangar: {} } }] })
    renderMenu(null)
    expect(await screen.findByText('Complete Agent mission setup')).toBeTruthy()
    expect(screen.queryByText('Launch Agent mission')).toBeNull()
  })

  it('launches a complete mission and reconciles metadata without clearing existing dirty state', async () => {
    useBoardStore.setState({
      tasks: [{
        ...task('t'),
        metadata: { hangar: { objective: 'recon', repo: 'aeon', agent: 'copilot', instruction: 'Inspect the repo', autoRun: true, sessionIds: ['older'] } },
      }],
      isDirty: true,
      lastMutatedAt: 456,
    })
    renderMenu(null)
    fireEvent.click(await screen.findByText('Launch Agent mission'))

    await waitFor(() => expect(spawnSessionFromCard).toHaveBeenCalledWith('p1', 't'))
    await waitFor(() => expect((useBoardStore.getState().tasks[0].metadata?.hangar as Record<string, unknown>).sessionIds).toEqual(['older', 'session-new']))
    const state = useBoardStore.getState()
    expect((state.tasks[0].metadata?.hangar as Record<string, unknown>).autoRun).toBe(false)
    expect(state.isDirty).toBe(true)
    expect(state.lastMutatedAt).toBe(456)
  })
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

  it('counts the other multi-selected cards on this board and requests the fusion', async () => {
    const requestFuse = vi.fn()
    useBoardStore.setState({ selectedTaskIds: ['a', 't', 'far', 'ghost', 'b'] })
    const { onClose } = renderMenu(requestFuse)

    const button = await screen.findByTestId('fuse-cards')
    expect(button.textContent).toContain('Fuse 3 cards into this one')
    expect(button.getAttribute('title')).toBe('Absorbs: card a, card b')

    fireEvent.click(button)
    expect(requestFuse).toHaveBeenCalledWith('t', ['a', 'b'])
    expect(onClose).toHaveBeenCalled()
  })

  it('never counts the keyboard single selection — opening a card sets it, and that must not arm a fuse', async () => {
    useBoardStore.setState({ selectedTaskIds: [], selectedTaskId: 'a' })
    renderMenu(vi.fn())
    expect(await screen.findByText('Select')).toBeTruthy()
    expect(screen.queryByTestId('fuse-cards')).toBeNull()
  })

  it('is absent outside a board (no fusion lifecycle to hand the request to)', async () => {
    useBoardStore.setState({ selectedTaskIds: ['a'] })
    renderMenu(null)
    expect(await screen.findByText('Select')).toBeTruthy()
    expect(screen.queryByTestId('fuse-cards')).toBeNull()
  })
})
