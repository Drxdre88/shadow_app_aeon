/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// Pins the flagship behaviour of pinned floating cards: while cards are
// pinned there is NO backdrop — the board underneath stays fully
// interactive — and multiple cards can be open, folded to the dock, and
// restored side by side.

// Server-action modules pulled in transitively by the card content — never
// exercised here, but they must not touch the DB layer at import time.
vi.mock('@/lib/actions/checklist', () => ({ getChecklistItems: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/actions/comments', () => ({
  getComments: vi.fn().mockResolvedValue([]),
  addComment: vi.fn(),
  editComment: vi.fn(),
  removeComment: vi.fn(),
}))
vi.mock('@/lib/actions/projects', () => ({ updateProjectSettings: vi.fn() }))
vi.mock('@/lib/actions/board', () => ({
  createBoardTask: vi.fn(),
  updateBoardTask: vi.fn(),
  deleteBoardTask: vi.fn(),
  reorderBoardTasks: vi.fn(),
}))

import { FloatingCardsLayer } from '../FloatingCardsLayer'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { usePinnedCardsStore } from '@/lib/store/pinnedCardsStore'

const PROJECT_ID = 'project-1'

const makeTask = (id: string, name: string): BoardTask => ({
  id,
  projectId: PROJECT_ID,
  name,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
})

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ObserverStub)
  vi.stubGlobal('ResizeObserver', ObserverStub)
  useBoardStore.setState({
    tasks: [makeTask('task-1', 'Alpha card'), makeTask('task-2', 'Beta card')],
    labels: [],
  })
  usePinnedCardsStore.setState({ cards: [], nextZ: 1 })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderLayer() {
  const result = render(
    <>
      <button data-testid="board-button">a board control</button>
      <FloatingCardsLayer projectId={PROJECT_ID} onUnpin={() => {}} />
    </>
  )
  // Flush the async checklist fetch kicked off on mount.
  await act(async () => {})
  return result
}

describe('FloatingCardsLayer', () => {
  it('renders nothing when no cards are pinned', async () => {
    await renderLayer()
    expect(document.querySelector('[data-floating-cards-layer]')).toBeNull()
  })

  it('a pinned card renders as a floating window with NO blocking backdrop', async () => {
    act(() => usePinnedCardsStore.getState().openCard('task-1'))
    await renderLayer()

    // The window is there…
    expect(screen.getByRole('dialog', { name: /Alpha card/ })).toBeTruthy()

    // …but the full-screen layer lets events pass through (pointer-events-none)
    const layer = document.querySelector('[data-floating-cards-layer]')!
    expect(layer.className).toContain('pointer-events-none')

    // …the window itself re-enables pointer events for its own surface only
    const shell = document.querySelector('[data-floating-card="task-1"]')!
    expect(shell.className).toContain('pointer-events-auto')

    // …and no modal backdrop exists anywhere (the edit modal's backdrop is
    // the fixed inset-0 bg-black/60 blur element).
    expect(document.querySelector('.bg-black\\/60')).toBeNull()
    expect(document.querySelector('.backdrop-blur-sm')).toBeNull()

    // The board control next to the layer is still reachable and clickable.
    const boardButton = screen.getByTestId('board-button')
    const onClick = vi.fn()
    boardButton.addEventListener('click', onClick)
    fireEvent.click(boardButton)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('supports multiple cards open side by side', async () => {
    act(() => {
      usePinnedCardsStore.getState().openCard('task-1')
      usePinnedCardsStore.getState().openCard('task-2')
    })
    await renderLayer()
    expect(screen.getByRole('dialog', { name: /Alpha card/ })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: /Beta card/ })).toBeTruthy()
    // Distinct cascade positions — they don't stack on top of each other.
    const a = document.querySelector('[data-floating-card="task-1"]') as HTMLElement
    const b = document.querySelector('[data-floating-card="task-2"]') as HTMLElement
    expect(a.style.left).not.toBe(b.style.left)
  })

  it('folds a card to a dock chip and restores it from there', async () => {
    act(() => usePinnedCardsStore.getState().openCard('task-1'))
    await renderLayer()

    fireEvent.click(screen.getByRole('button', { name: 'Fold away' }))

    // Window gone, chip present.
    expect(screen.queryByRole('dialog', { name: /Alpha card/ })).toBeNull()
    const dock = document.querySelector('[data-floating-cards-dock]')!
    expect(dock.textContent).toContain('Alpha card')

    fireEvent.click(screen.getByTitle('Restore Alpha card'))
    await act(async () => {}) // remounted window re-fetches its checklist
    expect(screen.getByRole('dialog', { name: /Alpha card/ })).toBeTruthy()
    expect(document.querySelector('[data-floating-cards-dock]')).toBeNull()
  })

  it('Escape closes only the focused floating card', async () => {
    act(() => {
      usePinnedCardsStore.getState().openCard('task-1')
      usePinnedCardsStore.getState().openCard('task-2')
    })
    await renderLayer()

    fireEvent.keyDown(screen.getByRole('dialog', { name: /Alpha card/ }), { key: 'Escape' })

    expect(usePinnedCardsStore.getState().cards.map((c) => c.taskId)).toEqual(['task-2'])
    expect(screen.queryByRole('dialog', { name: /Alpha card/ })).toBeNull()
    expect(screen.getByRole('dialog', { name: /Beta card/ })).toBeTruthy()
  })

  it('closing from the window chrome removes the card', async () => {
    act(() => usePinnedCardsStore.getState().openCard('task-1'))
    await renderLayer()
    fireEvent.click(screen.getByRole('button', { name: 'Close pinned card' }))
    expect(usePinnedCardsStore.getState().cards).toEqual([])
  })

  it('drops cards whose task no longer exists', async () => {
    act(() => usePinnedCardsStore.getState().openCard('task-1'))
    await renderLayer()
    act(() => useBoardStore.setState({ tasks: [makeTask('task-2', 'Beta card')] }))
    expect(usePinnedCardsStore.getState().cards).toEqual([])
  })
})
