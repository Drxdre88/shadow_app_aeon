/** @vitest-environment jsdom */
import { type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core'
import { TaskChecklist } from '../TaskChecklist'
import type { ChecklistItem } from '../types'

// dnd-kit's sensors need real layout, which jsdom has none of. The DndContext
// the checklist renders is intercepted and its handlers invoked with the
// events dnd-kit would have reported — what matters is the slot the drop
// resolves to, the insertion line shown while dragging, and where the drag
// preview is mounted.
const dnd = vi.hoisted(() => ({
  onDragStart: null as ((e: DragStartEvent) => void) | null,
  onDragMove: null as ((e: DragMoveEvent) => void) | null,
  onDragEnd: null as ((e: DragEndEvent) => void) | null,
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      if (props.onDragStart) dnd.onDragStart = props.onDragStart
      if (props.onDragMove) dnd.onDragMove = props.onDragMove
      if (props.onDragEnd) dnd.onDragEnd = props.onDragEnd
      return createElement(actual.DndContext, props)
    },
    // The real overlay renders nothing without dnd-kit's own active drag,
    // which the injected handlers never set; a host div exposes where the
    // checklist mounted it.
    DragOverlay: (props: ComponentProps<typeof actual.DragOverlay>) =>
      createElement('div', { 'data-overlay-host': '' }, props.children),
  }
})

function item(id: string, groupName: string): ChecklistItem {
  return { id, title: id, completed: false, state: 'unchecked', status: null, groupName }
}

// A=[a1,a2], B=[b1,b2]
const items = [item('a1', 'A'), item('a2', 'A'), item('b1', 'B'), item('b2', 'B')]

function layoutRows(tops: Record<string, number>) {
  for (const el of Array.from(document.querySelectorAll('[data-checklist-item-id]'))) {
    const id = el.getAttribute('data-checklist-item-id')!
    const top = tops[id]
    ;(el as HTMLElement).getBoundingClientRect = () => ({
      top, height: 40, bottom: top + 40, left: 0, right: 300, width: 300, x: 0, y: top, toJSON() {},
    }) as DOMRect
  }
}

function evt(activeId: string, overId: string | null, clientY: number) {
  return {
    active: { id: activeId, data: { current: { type: 'item' } }, rect: { current: { translated: null, initial: null } } },
    over: overId ? { id: overId } : null,
    delta: { x: 0, y: 0 },
    activatorEvent: { clientY },
    collisions: null,
  } as unknown as DragMoveEvent & DragEndEvent & DragStartEvent
}

beforeAll(() => {
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
  else if (!CSS.escape) CSS.escape = (s: string) => s
})
afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('TaskChecklist item drag', () => {
  it('mounts the drag preview on the body, outside the checklist (and its blurred/transformed ancestors)', () => {
    render(<TaskChecklist taskId="t" items={items} />)
    act(() => dnd.onDragStart!(evt('a1', null, 0)))
    const overlay = document.querySelector('[data-checklist-drag-overlay]')
    expect(overlay).not.toBeNull()
    expect(overlay!.closest('[data-checklist-root]')).toBeNull()
  })

  it('shows the insertion line at the pointer slot of the target group and drops there', () => {
    const onItemReorder = vi.fn()
    render(<TaskChecklist taskId="t" items={items} onItemReorder={onItemReorder} />)
    // A rows at 0/44, B rows at 200/244.
    layoutRows({ a1: 0, a2: 44, b1: 200, b2: 244 })

    act(() => dnd.onDragStart!(evt('a1', null, 10)))
    // Pointer at 230: past b1's midpoint (220), before b2's (264) → between them.
    act(() => dnd.onDragMove!(evt('a1', 'b1', 230)))
    const line = document.querySelector('[data-drop-indicator]')!
    expect(line.getAttribute('data-drop-indicator')).toBe('before')
    expect(line.closest('[data-checklist-item-id]')!.getAttribute('data-checklist-item-id')).toBe('b2')

    act(() => dnd.onDragEnd!(evt('a1', 'b1', 230)))
    expect(onItemReorder).toHaveBeenCalledWith([
      { id: 'a2', groupName: 'A' },
      { id: 'b1', groupName: 'B' },
      { id: 'a1', groupName: 'B' },
      { id: 'b2', groupName: 'B' },
    ])
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
  })

  it('past the last row the line sits below it and the drop appends', () => {
    const onItemReorder = vi.fn()
    render(<TaskChecklist taskId="t" items={items} onItemReorder={onItemReorder} />)
    layoutRows({ a1: 0, a2: 44, b1: 200, b2: 244 })
    act(() => dnd.onDragStart!(evt('a2', null, 50)))
    act(() => dnd.onDragMove!(evt('a2', 'B', 290)))
    const line = document.querySelector('[data-drop-indicator]')!
    expect(line.getAttribute('data-drop-indicator')).toBe('after')
    expect(line.closest('[data-checklist-item-id]')!.getAttribute('data-checklist-item-id')).toBe('b2')
    act(() => dnd.onDragEnd!(evt('a2', 'B', 290)))
    expect(onItemReorder).toHaveBeenCalledWith([
      { id: 'a1', groupName: 'A' },
      { id: 'b1', groupName: 'B' },
      { id: 'b2', groupName: 'B' },
      { id: 'a2', groupName: 'B' },
    ])
  })

  it('a drop back onto its own slot writes nothing', () => {
    const onItemReorder = vi.fn()
    render(<TaskChecklist taskId="t" items={items} onItemReorder={onItemReorder} />)
    layoutRows({ a1: 0, a2: 44, b1: 200, b2: 244 })
    act(() => dnd.onDragStart!(evt('a1', null, 10)))
    act(() => dnd.onDragEnd!(evt('a1', 'a2', 10)))
    expect(onItemReorder).not.toHaveBeenCalled()
  })
})
