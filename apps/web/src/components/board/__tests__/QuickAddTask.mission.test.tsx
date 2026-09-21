/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuickAddTask } from '../QuickAddTask'
import { useBoardStore } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import { readMissionCard } from '../autoRun'

beforeEach(() => {
  localStorage.clear()
  useBoardStore.setState({ tasks: [], labels: [], columns: [] })
  useHangarUiStore.setState({
    projectId: 'project-1',
    config: { enabled: true, triggerColumnId: null },
    missionEditorTaskId: null,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('QuickAddTask Agent mission', () => {
  it('persists the mission discriminator before opening the editor', () => {
    const onTaskCreate = vi.fn()
    render(<QuickAddTask projectId="project-1" columnId="column-1" onTaskCreate={onTaskCreate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    fireEvent.change(screen.getByPlaceholderText('Card name...'), { target: { value: 'Investigate launch flow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agent mission' }))

    const created = useBoardStore.getState().tasks[0]
    expect(readMissionCard(created.metadata)).toEqual(expect.objectContaining({
      objective: 'implement',
      repo: null,
      agent: 'copilot',
      instruction: null,
    }))
    expect(onTaskCreate).toHaveBeenCalledWith(expect.objectContaining({ metadata: created.metadata }))
    expect(useHangarUiStore.getState().missionEditorTaskId).toBe(created.id)

    useHangarUiStore.getState().closeMissionEditor()
    expect(readMissionCard(useBoardStore.getState().tasks[0].metadata)).not.toBeNull()
    const persisted = JSON.parse(localStorage.getItem('aeon-board') ?? '{}') as { state?: { tasks?: Array<{ metadata?: Record<string, unknown> }> } }
    expect(readMissionCard(persisted.state?.tasks?.[0]?.metadata)).not.toBeNull()
  })

  it('keeps ordinary quick-add cards ordinary', () => {
    render(<QuickAddTask projectId="project-1" columnId="column-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    fireEvent.change(screen.getByPlaceholderText('Card name...'), { target: { value: 'Ordinary card' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(readMissionCard(useBoardStore.getState().tasks[0].metadata)).toBeNull()
  })
})
