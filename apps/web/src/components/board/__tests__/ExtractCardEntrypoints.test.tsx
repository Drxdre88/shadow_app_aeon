/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }),
}))
vi.mock('../useHoldToMove', () => ({
  useCardHoldGesture: () => ({ holdHandlers: {}, consumeHoldClick: () => false }),
  useHoldToMoveActions: () => null,
  halfFromPoint: () => 'top',
}))
vi.mock('../CardPeekPreview', () => ({ CardPeekPreview: () => null }))
vi.mock('../ExtractCardContentsModal', () => ({ ExtractCardContentsModal: ({ taskId }: { taskId: string }) => <div role="dialog" data-task={taskId}>Card extraction</div> }))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/actions/transfer', () => ({ listProjectsForTransfer: vi.fn().mockResolvedValue([]), copyTaskToProject: vi.fn(), moveTaskToProject: vi.fn() }))
vi.mock('@/lib/actions/hangar', () => ({ spawnSessionFromCard: vi.fn() }))

import { SortableTaskCard } from '../SortableTaskCard'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'

const task: BoardTask = {
  id: 'card', projectId: 'project', name: 'Card', description: 'Body', columnId: 'column',
  status: 'todo', priority: 'medium', color: 'purple', labels: [], onTimeline: false, orderIndex: 0,
}

beforeEach(() => {
  useBoardStore.setState({ tasks: [task], columns: [], labels: [], selectedTaskIds: [], selectedTaskId: null, movingTaskId: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderCard() {
  render(<SortableTaskCard task={task} columnGlowColor="#777" animateOnMount={false} />)
}

describe('Extract contents entry points', () => {
  it('opens the extraction from the right-click card menu', async () => {
    renderCard()
    fireEvent.contextMenu(document.querySelector('[data-card-surface]')!, { clientX: 10, clientY: 10 })
    fireEvent.click(await screen.findByText('Extract contents'))
    expect(screen.getByRole('dialog').getAttribute('data-task')).toBe('card')
  })

  it('opens the same extraction from the card ellipsis', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }))
    fireEvent.click(await screen.findByText('Extract contents'))
    expect(screen.getByRole('dialog').getAttribute('data-task')).toBe('card')
  })
})
