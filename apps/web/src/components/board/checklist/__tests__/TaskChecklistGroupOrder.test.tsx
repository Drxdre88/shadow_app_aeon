/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { TaskChecklist } from '../TaskChecklist'
import type { ChecklistItem } from '../types'

// The add-group button carries a same-frame double-click guard released on the
// next animation frame. Stub rAF with an explicit queue so the tests can
// release it deterministically between clicks.
let rafQueue: FrameRequestCallback[] = []

beforeEach(() => {
  rafQueue = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function flushRaf() {
  const queue = rafQueue
  rafQueue = []
  act(() => {
    for (const cb of queue) cb(0)
  })
}

// Live-reported bug: create several checklist groups (some still empty), add an
// item to a LOWER group while the higher ones are empty → the groups jumped
// (the lower group moved to the top). Trello keeps groups exactly where the
// user created them; these tests lock that behavior.

type AddCall = { title: string; groupName: string; orderedGroups?: string[] }

function Harness({ calls }: { calls: AddCall[] }) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  return (
    <TaskChecklist
      taskId="task-1"
      items={items}
      onItemAdd={(title, groupName, orderedGroups) => {
        calls.push({ title, groupName, orderedGroups })
        setItems((prev) => [
          ...prev,
          {
            id: `i-${prev.length}`,
            title,
            completed: false,
            state: 'unchecked',
            status: null,
            groupName,
          },
        ])
      }}
    />
  )
}

function groupHeaderOrder() {
  // The header button also contains the "0/0" count span — read only the
  // direct text nodes (the same text the matcher matched against).
  return screen.getAllByText(/^Checklist \d+$/).map((el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim(),
  )
}

/** Click "Add checklist group", then release its same-frame rAF double-click guard. */
function addGroup() {
  fireEvent.click(screen.getByLabelText('Add checklist group'))
  flushRaf()
}

function commitItemInOpenInput(title: string) {
  const input = screen.getByPlaceholderText('New item…')
  fireEvent.change(input, { target: { value: title } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('TaskChecklist group order stability', () => {
  it('empty groups hold their position when an item is committed to a lower group', () => {
    const calls: AddCall[] = []
    render(<Harness calls={calls} />)

    // Three empty ("ghost") groups, created in order.
    addGroup() // Checklist 2
    addGroup() // Checklist 3
    addGroup() // Checklist 4
    expect(groupHeaderOrder()).toEqual(['Checklist 2', 'Checklist 3', 'Checklist 4'])

    // The add input auto-opened in the LAST group — commit the first item there
    // while the two higher groups are still empty.
    commitItemInOpenInput('later item')

    // Before the fix: 'Checklist 4' jumped to the top (item-derived groups were
    // listed before pending empty ones).
    expect(groupHeaderOrder()).toEqual(['Checklist 2', 'Checklist 3', 'Checklist 4'])
    expect(calls.at(-1)).toEqual({
      title: 'later item',
      groupName: 'Checklist 4',
      orderedGroups: ['Checklist 2', 'Checklist 3', 'Checklist 4'],
    })
  })

  it('adding an item to a higher group afterwards still never reorders groups', () => {
    const calls: AddCall[] = []
    render(<Harness calls={calls} />)

    addGroup() // Checklist 2
    addGroup() // Checklist 3
    addGroup() // Checklist 4
    expect(groupHeaderOrder()).toEqual(['Checklist 2', 'Checklist 3', 'Checklist 4'])
    commitItemInOpenInput('later item') // lands in Checklist 4

    // Open the add input in the FIRST (still empty) group and commit there.
    fireEvent.click(screen.getAllByText('Add item')[0])
    commitItemInOpenInput('first item')

    expect(groupHeaderOrder()).toEqual(['Checklist 2', 'Checklist 3', 'Checklist 4'])
    // The display order travels with the add so the server can persist
    // matching indices (reload parity).
    expect(calls.at(-1)).toEqual({
      title: 'first item',
      groupName: 'Checklist 2',
      orderedGroups: ['Checklist 2', 'Checklist 3', 'Checklist 4'],
    })
  })
})
