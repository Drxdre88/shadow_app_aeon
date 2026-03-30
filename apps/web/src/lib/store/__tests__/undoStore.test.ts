import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUndoStore } from '../undoStore'

beforeEach(() => {
  useUndoStore.setState({ stack: [] })
})

describe('push', () => {
  it('adds entry to the stack', () => {
    useUndoStore.getState().push('rename card', vi.fn())
    expect(useUndoStore.getState().stack).toHaveLength(1)
  })

  it('stores description and callable undo on the entry', () => {
    const undoFn = vi.fn()
    useUndoStore.getState().push('delete column', undoFn)
    const entry = useUndoStore.getState().stack[0]
    expect(entry.description).toBe('delete column')
    entry.undo()
    expect(undoFn).toHaveBeenCalledOnce()
  })

  it('returns a non-empty string id', () => {
    const id = useUndoStore.getState().push('move card', vi.fn())
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('returns unique ids across calls', () => {
    const ids = Array.from({ length: 10 }, (_, i) =>
      useUndoStore.getState().push(`action ${i}`, vi.fn())
    )
    const unique = new Set(ids)
    expect(unique.size).toBe(10)
  })

  it('places the most recent entry at the top (index 0)', () => {
    useUndoStore.getState().push('first', vi.fn())
    useUndoStore.getState().push('second', vi.fn())
    expect(useUndoStore.getState().stack[0].description).toBe('second')
  })

  it('evicts the oldest entry when stack exceeds 20', () => {
    for (let i = 0; i < 20; i++) {
      useUndoStore.getState().push(`action ${i}`, vi.fn())
    }
    const idOfOldest = useUndoStore.getState().stack[19].id

    useUndoStore.getState().push('action 20', vi.fn())

    const stackAfter = useUndoStore.getState().stack
    expect(stackAfter).toHaveLength(20)
    expect(stackAfter.find((e) => e.id === idOfOldest)).toBeUndefined()
  })

  it('keeps exactly 20 entries after pushing 25', () => {
    for (let i = 0; i < 25; i++) {
      useUndoStore.getState().push(`action ${i}`, vi.fn())
    }
    expect(useUndoStore.getState().stack).toHaveLength(20)
  })

  it('stamps each entry with a numeric timestamp', () => {
    useUndoStore.getState().push('timestamp check', vi.fn())
    const { timestamp } = useUndoStore.getState().stack[0]
    expect(typeof timestamp).toBe('number')
    expect(timestamp).toBeGreaterThan(0)
  })
})

describe('pop', () => {
  it('returns and removes the most recent entry', () => {
    useUndoStore.getState().push('first', vi.fn())
    useUndoStore.getState().push('second', vi.fn())

    const popped = useUndoStore.getState().pop()

    expect(popped?.description).toBe('second')
    expect(useUndoStore.getState().stack).toHaveLength(1)
    expect(useUndoStore.getState().stack[0].description).toBe('first')
  })

  it('returns null when stack is empty', () => {
    const result = useUndoStore.getState().pop()
    expect(result).toBeNull()
  })

  it('leaves stack empty after popping the only entry', () => {
    useUndoStore.getState().push('solo', vi.fn())
    useUndoStore.getState().pop()
    expect(useUndoStore.getState().stack).toHaveLength(0)
  })

  it('returns entry with a callable undo function', () => {
    const undoFn = vi.fn()
    useUndoStore.getState().push('callable check', undoFn)
    const entry = useUndoStore.getState().pop()
    entry?.undo()
    expect(undoFn).toHaveBeenCalledOnce()
  })
})

describe('remove', () => {
  it('deletes the entry with the matching id', () => {
    useUndoStore.getState().push('keep me', vi.fn())
    const removeId = useUndoStore.getState().push('remove me', vi.fn())

    useUndoStore.getState().remove(removeId)

    const remaining = useUndoStore.getState().stack
    expect(remaining).toHaveLength(1)
    expect(remaining[0].description).toBe('keep me')
  })

  it('is a no-op when id does not exist', () => {
    useUndoStore.getState().push('existing', vi.fn())
    useUndoStore.getState().remove('nonexistent-id')
    expect(useUndoStore.getState().stack).toHaveLength(1)
  })

  it('leaves stack empty when removing the only entry', () => {
    const id = useUndoStore.getState().push('only', vi.fn())
    useUndoStore.getState().remove(id)
    expect(useUndoStore.getState().stack).toHaveLength(0)
  })
})

describe('popById', () => {
  it('returns and removes the entry matching the given id', () => {
    useUndoStore.getState().push('alpha', vi.fn())
    const targetId = useUndoStore.getState().push('beta', vi.fn())
    useUndoStore.getState().push('gamma', vi.fn())

    const result = useUndoStore.getState().popById(targetId)

    expect(result?.description).toBe('beta')
    const remaining = useUndoStore.getState().stack
    expect(remaining).toHaveLength(2)
    expect(remaining.find((e) => e.id === targetId)).toBeUndefined()
  })

  it('returns null for a non-existent id', () => {
    useUndoStore.getState().push('some action', vi.fn())
    const result = useUndoStore.getState().popById('ghost-id')
    expect(result).toBeNull()
  })

  it('does not mutate the stack when id is not found', () => {
    useUndoStore.getState().push('unchanged', vi.fn())
    useUndoStore.getState().popById('ghost-id')
    expect(useUndoStore.getState().stack).toHaveLength(1)
  })

  it('returns entry with a callable undo function', () => {
    const undoFn = vi.fn()
    const id = useUndoStore.getState().push('by-id callable', undoFn)
    const entry = useUndoStore.getState().popById(id)
    entry?.undo()
    expect(undoFn).toHaveBeenCalledOnce()
  })
})

describe('clear', () => {
  it('empties a populated stack', () => {
    useUndoStore.getState().push('a', vi.fn())
    useUndoStore.getState().push('b', vi.fn())
    useUndoStore.getState().push('c', vi.fn())

    useUndoStore.getState().clear()

    expect(useUndoStore.getState().stack).toHaveLength(0)
  })

  it('is safe to call on an already empty stack', () => {
    useUndoStore.getState().clear()
    expect(useUndoStore.getState().stack).toHaveLength(0)
  })
})
