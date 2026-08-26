/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

// Locks the new-label responsiveness fix: a label created from inside a card
// appears instantly (optimistic store insert + optimistic assignment) and the
// server-side assignment fires only AFTER the create has persisted, so the
// two writes can no longer race (the old parallel fire lost the FK race and
// silently dropped the label off the card).

import { LabelPicker } from '../LabelPicker'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'

const TASK_ID = 'task-1'
const PROJECT_ID = 'project-1'

const task: BoardTask = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  name: 'A task',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
}

function seedStore(labels: Array<{ id: string; projectId: string; name: string; color: string }> = []) {
  useBoardStore.setState({ tasks: [{ ...task, labels: [] }], labels })
}

function createLabelThroughUi(name: string) {
  fireEvent.click(screen.getByText('Create new label'))
  fireEvent.change(screen.getByPlaceholderText('Label name...'), { target: { value: name } })
  fireEvent.click(screen.getByText('Create'))
}

beforeEach(() => {
  vi.clearAllMocks()
  seedStore()
})

afterEach(() => {
  cleanup()
})

describe('LabelPicker create flow', () => {
  it('optimistically adds the new label to the store and the current task instantly', () => {
    const onLabelCreate = vi.fn(() => new Promise<boolean>(() => {})) // never resolves
    render(
      <LabelPicker
        taskId={TASK_ID}
        projectId={PROJECT_ID}
        isOpen
        onClose={() => {}}
        onLabelCreate={onLabelCreate}
      />
    )

    createLabelThroughUi('fresh')

    const state = useBoardStore.getState()
    const created = state.labels.find((l) => l.name === 'fresh')
    expect(created).toBeDefined()
    // Immediately assignable/assigned — no save/reopen needed.
    expect(state.tasks[0].labels).toContain(created!.id)
    expect(onLabelCreate).toHaveBeenCalledTimes(1)
  })

  it('defers the server assignment until the create resolves, then fires it', async () => {
    let resolveCreate!: (ok: boolean) => void
    const onLabelCreate = vi.fn(() => new Promise<boolean>((res) => { resolveCreate = res }))
    const onLabelToggle = vi.fn()
    render(
      <LabelPicker
        taskId={TASK_ID}
        projectId={PROJECT_ID}
        isOpen
        onClose={() => {}}
        onLabelCreate={onLabelCreate}
        onLabelToggle={onLabelToggle}
      />
    )

    createLabelThroughUi('sequenced')

    // Create still in flight: the assignment must not have raced ahead.
    expect(onLabelToggle).not.toHaveBeenCalled()

    resolveCreate(true)
    await waitFor(() => expect(onLabelToggle).toHaveBeenCalledTimes(1))
    const createdId = useBoardStore.getState().labels.find((l) => l.name === 'sequenced')!.id
    expect(onLabelToggle).toHaveBeenCalledWith(TASK_ID, createdId, 'add')
  })

  it('rolls the optimistic assignment back when the create fails', async () => {
    const onLabelCreate = vi.fn(() => Promise.resolve(false))
    const onLabelToggle = vi.fn()
    render(
      <LabelPicker
        taskId={TASK_ID}
        projectId={PROJECT_ID}
        isOpen
        onClose={() => {}}
        onLabelCreate={onLabelCreate}
        onLabelToggle={onLabelToggle}
      />
    )

    createLabelThroughUi('doomed')

    await waitFor(() => expect(useBoardStore.getState().tasks[0].labels).toHaveLength(0))
    expect(onLabelToggle).not.toHaveBeenCalled()
  })

  it('still assigns immediately when no create handler is wired (local-only boards)', () => {
    render(
      <LabelPicker taskId={TASK_ID} projectId={PROJECT_ID} isOpen onClose={() => {}} />
    )

    createLabelThroughUi('local')

    const state = useBoardStore.getState()
    const created = state.labels.find((l) => l.name === 'local')
    expect(created).toBeDefined()
    expect(state.tasks[0].labels).toContain(created!.id)
  })
})

describe('LabelPicker ordering', () => {
  it('lists labels alphabetically regardless of creation order', () => {
    seedStore([
      { id: 'l1', projectId: PROJECT_ID, name: 'zebra', color: 'purple' },
      { id: 'l2', projectId: PROJECT_ID, name: 'Apple', color: 'blue' },
      { id: 'l3', projectId: PROJECT_ID, name: 'mango', color: 'green' },
    ])
    render(
      <LabelPicker taskId={TASK_ID} projectId={PROJECT_ID} isOpen onClose={() => {}} />
    )

    const names = ['Apple', 'mango', 'zebra']
    const rendered = names
      .map((n) => screen.getByText(n))
      .map((el) => el.textContent)
    expect(rendered).toEqual(names)
    // DOM order check: Apple before mango before zebra.
    const apple = screen.getByText('Apple')
    const mango = screen.getByText('mango')
    const zebra = screen.getByText('zebra')
    expect(apple.compareDocumentPosition(mango) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mango.compareDocumentPosition(zebra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
