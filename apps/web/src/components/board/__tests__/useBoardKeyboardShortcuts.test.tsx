/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBoardKeyboardShortcuts } from '../useBoardKeyboardShortcuts'

const callbacks = {
  onOpenLabel: vi.fn(),
  onOpenColorPicker: vi.fn(),
  onOpenPriorityPicker: vi.fn(),
  onEditCard: vi.fn(),
  onToggleDone: vi.fn(),
  onAddTask: vi.fn(),
  onCopyCard: vi.fn(),
  onPasteCard: vi.fn(),
  onSelectTask: vi.fn(),
}

const columns = [{ id: 'column-1', projectId: 'project-1', name: 'Todo', color: '#fff', icon: null, orderIndex: 0 }]

function mount(overrides: Record<string, unknown> = {}) {
  return renderHook(() => useBoardKeyboardShortcuts({
    hoveredTaskId: 'task-1',
    selectedTaskId: null,
    shortcuts: null,
    sortedColumns: columns,
    hasOpenOverlay: false,
    canPasteCard: true,
    ...callbacks,
    ...overrides,
  }))
}

function press(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  target.dispatchEvent(event)
  return event
}

describe('board clipboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<div data-board-export><div data-task-id="task-1">Card title</div></div><div id="elsewhere">Elsewhere text</div>'
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })

  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    it(`leaves selected text to native copy with ${modifier}`, () => {
      mount()
      const text = document.getElementById('elsewhere')!.firstChild!
      const range = document.createRange()
      range.selectNodeContents(text)
      window.getSelection()!.addRange(range)

      const event = press(document.body, 'c', { [modifier]: true })

      expect(event.defaultPrevented).toBe(false)
      expect(callbacks.onCopyCard).not.toHaveBeenCalled()
    })

    it(`keeps native editor copy and paste with ${modifier}`, () => {
      mount()
      const editor = document.createElement('div')
      editor.contentEditable = 'true'
      editor.innerHTML = '<span id="nested-editor">editable</span>'
      document.body.appendChild(editor)
      const input = document.createElement('input')
      document.body.appendChild(input)
      const select = document.createElement('select')
      document.body.appendChild(select)

      for (const target of [input, select, document.getElementById('nested-editor')!]) {
        expect(press(target, 'c', { [modifier]: true }).defaultPrevented).toBe(false)
        expect(press(target, 'v', { [modifier]: true }).defaultPrevented).toBe(false)
      }
      expect(callbacks.onCopyCard).not.toHaveBeenCalled()
      expect(callbacks.onPasteCard).not.toHaveBeenCalled()
    })

    it(`leaves modal copy and paste native with ${modifier}`, () => {
      mount()
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      document.body.appendChild(dialog)

      expect(press(document.body, 'c', { [modifier]: true }).defaultPrevented).toBe(false)
      expect(press(dialog, 'v', { [modifier]: true }).defaultPrevented).toBe(false)
      expect(callbacks.onCopyCard).not.toHaveBeenCalled()
      expect(callbacks.onPasteCard).not.toHaveBeenCalled()
    })

    it(`keeps board shortcuts active beside a modeless pinned dialog with ${modifier}`, () => {
      mount({ selectedTaskId: 'task-1' })
      const pinnedDialog = document.createElement('div')
      pinnedDialog.setAttribute('role', 'dialog')
      document.body.appendChild(pinnedDialog)
      const boardCard = document.querySelector('[data-task-id]')!

      expect(press(boardCard, 'c', { [modifier]: true }).defaultPrevented).toBe(true)
      expect(callbacks.onCopyCard).toHaveBeenCalledWith('task-1')
      expect(press(boardCard, 'e').defaultPrevented).toBe(true)
      expect(callbacks.onEditCard).toHaveBeenCalledWith('task-1')
      expect(press(boardCard, 'ArrowRight').defaultPrevented).toBe(true)
      expect(press(pinnedDialog, 'c', { [modifier]: true }).defaultPrevented).toBe(false)
      expect(callbacks.onCopyCard).toHaveBeenCalledTimes(1)
    })

    it(`leaves copy and paste native outside board context with ${modifier}`, () => {
      mount()
      const outside = document.getElementById('elsewhere')!

      expect(press(outside, 'c', { [modifier]: true }).defaultPrevented).toBe(false)
      expect(press(outside, 'v', { [modifier]: true }).defaultPrevented).toBe(false)
      expect(callbacks.onCopyCard).not.toHaveBeenCalled()
      expect(callbacks.onPasteCard).not.toHaveBeenCalled()
    })

    it(`copies a card and pastes it only with a board destination and copied card for ${modifier}`, () => {
      mount()
      const boardCard = document.querySelector('[data-task-id]')!

      expect(press(boardCard, 'c', { [modifier]: true }).defaultPrevented).toBe(true)
      expect(callbacks.onCopyCard).toHaveBeenCalledWith('task-1')
      expect(press(boardCard, 'v', { [modifier]: true }).defaultPrevented).toBe(true)
      expect(callbacks.onPasteCard).toHaveBeenCalledTimes(1)
    })

    it(`preserves native paste when the internal card or board destination is absent for ${modifier}`, () => {
      mount({ canPasteCard: false, hoveredTaskId: null, selectedTaskId: null })

      expect(press(document.body, 'v', { [modifier]: true }).defaultPrevented).toBe(false)
      expect(callbacks.onPasteCard).not.toHaveBeenCalled()
    })
  }

  it('does not run bare-letter commands for modified keys', () => {
    mount({ hoveredTaskId: null, selectedTaskId: null, canPasteCard: false })

    expect(press(document.body, 'c', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(document.body, 'v', { metaKey: true }).defaultPrevented).toBe(false)
    expect(press(document.body, 'c', { altKey: true }).defaultPrevented).toBe(false)
    expect(callbacks.onAddTask).not.toHaveBeenCalled()
    expect(callbacks.onOpenPriorityPicker).not.toHaveBeenCalled()
  })

  it('leaves the board shortcuts idle while a board overlay is open', () => {
    mount({ hasOpenOverlay: true })
    const boardCard = document.querySelector('[data-task-id]')!

    expect(press(boardCard, 'c', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(boardCard, 'v', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(boardCard, 'e').defaultPrevented).toBe(false)
    expect(callbacks.onCopyCard).not.toHaveBeenCalled()
    expect(callbacks.onPasteCard).not.toHaveBeenCalled()
    expect(callbacks.onEditCard).not.toHaveBeenCalled()
  })
})
