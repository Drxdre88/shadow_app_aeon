import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBoardStore,
  isDirtyOrGracePeriod,
  registerPendingWritesSource,
  beginDirectWrite,
  endDirectWrite,
} from '../boardStore'

// Guards the clobber fix: a board reload (poll / Pusher echo) must be blocked
// while ANY write is in flight, even after some other writer has reset the
// global isDirty boolean to false.

beforeEach(() => {
  useBoardStore.setState({ isDirty: false, lastMutatedAt: 0 })
})

describe('isDirtyOrGracePeriod pending-write sources', () => {
  it('is false when clean, no pending writes, grace period expired', () => {
    expect(isDirtyOrGracePeriod()).toBe(false)
  })

  it('stays true while a direct write is in flight even if isDirty was reset', () => {
    beginDirectWrite()
    useBoardStore.setState({ isDirty: false })
    expect(isDirtyOrGracePeriod()).toBe(true)
    endDirectWrite()
    expect(isDirtyOrGracePeriod()).toBe(false)
  })

  it('refcounts overlapping direct writes', () => {
    beginDirectWrite()
    beginDirectWrite()
    endDirectWrite()
    expect(isDirtyOrGracePeriod()).toBe(true)
    endDirectWrite()
    expect(isDirtyOrGracePeriod()).toBe(false)
  })

  it('never goes negative on unbalanced endDirectWrite', () => {
    endDirectWrite()
    endDirectWrite()
    expect(isDirtyOrGracePeriod()).toBe(false)
    beginDirectWrite()
    expect(isDirtyOrGracePeriod()).toBe(true)
    endDirectWrite()
  })

  it('consults registered external sources (mutation queue)', () => {
    let queueBusy = false
    registerPendingWritesSource(() => queueBusy)
    expect(isDirtyOrGracePeriod()).toBe(false)
    queueBusy = true
    expect(isDirtyOrGracePeriod()).toBe(true)
    queueBusy = false
    expect(isDirtyOrGracePeriod()).toBe(false)
  })
})
