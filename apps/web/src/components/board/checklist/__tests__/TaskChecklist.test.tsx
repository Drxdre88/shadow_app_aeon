/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskChecklist } from '../TaskChecklist'
import type { ChecklistItem } from '../types'

afterEach(cleanup)

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'item-1',
    title: 'Existing item',
    completed: false,
    state: 'unchecked',
    status: null,
    groupName: 'Checklist',
    ...overrides,
  }
}

function setup(items: ChecklistItem[] = []) {
  const onItemAdd = vi.fn()
  render(<TaskChecklist taskId="task-1" items={items} onItemAdd={onItemAdd} />)
  return { onItemAdd }
}

function openGhostInput() {
  fireEvent.click(screen.getByText('Add item'))
  return screen.getByPlaceholderText('New item…')
}

describe('TaskChecklist ghost input', () => {
  it('commits the typed title on Enter', () => {
    const { onItemAdd } = setup()
    const input = openGhostInput()
    fireEvent.change(input, { target: { value: 'Buy milk' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onItemAdd).toHaveBeenCalledTimes(1)
    expect(onItemAdd).toHaveBeenCalledWith('Buy milk', 'Checklist')
  })

  it('chains: Enter re-opens an empty ghost input for the next item', () => {
    const { onItemAdd } = setup()
    const input = openGhostInput()
    fireEvent.change(input, { target: { value: 'First' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const next = screen.getByPlaceholderText('New item…') as HTMLTextAreaElement
    expect(next.value).toBe('')
    fireEvent.change(next, { target: { value: 'Second' } })
    fireEvent.keyDown(next, { key: 'Enter' })
    expect(onItemAdd).toHaveBeenCalledTimes(2)
    expect(onItemAdd).toHaveBeenLastCalledWith('Second', 'Checklist')
  })

  it('creates nothing on Enter with empty or whitespace-only text', () => {
    const { onItemAdd } = setup()
    const input = openGhostInput()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.submit(input.closest('form')!)
    expect(onItemAdd).not.toHaveBeenCalled()
  })

  it('creates nothing on Escape, even with text typed', () => {
    const { onItemAdd } = setup()
    const input = openGhostInput()
    fireEvent.change(input, { target: { value: 'abandoned' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onItemAdd).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('New item…')).toBeNull()
  })

  it('creates nothing on blur with empty text', () => {
    const { onItemAdd } = setup()
    const input = openGhostInput()
    fireEvent.blur(input)
    expect(onItemAdd).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('New item…')).toBeNull()
  })

  it('keeps the input open (uncommitted) on blur with text', () => {
    const { onItemAdd } = setup()
    const input = openGhostInput()
    fireEvent.change(input, { target: { value: 'draft' } })
    fireEvent.blur(input)
    expect(onItemAdd).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('New item…')).toBeTruthy()
  })

  it('adding a group persists no item — only commits on typed Enter', () => {
    const { onItemAdd } = setup([makeItem()])
    fireEvent.click(screen.getByLabelText('Add checklist group'))
    expect(onItemAdd).not.toHaveBeenCalled()
    expect(screen.getByText(/Checklist 2/)).toBeTruthy()
    const input = screen.getByPlaceholderText('New item…')
    fireEvent.change(input, { target: { value: 'Real first item' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onItemAdd).toHaveBeenCalledTimes(1)
    expect(onItemAdd).toHaveBeenCalledWith('Real first item', 'Checklist 2')
  })
})
