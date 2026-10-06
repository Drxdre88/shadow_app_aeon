/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// The board must reload whenever it can't prove the cards on screen match the
// server — an unknown version is never adopted as "current".

let dirty = false
vi.mock('@/lib/store/boardStore', () => ({
  isDirtyOrGracePeriod: () => dirty,
}))

import { useBoardFreshness, POLL_INTERVAL_MS, RECHECK_MS } from '../useBoardFreshness'

const PROJECT_ID = 'p1'
let serverVersion: number | null = 5
const fetchMock = vi.fn(async () => (
  serverVersion === null
    ? new Response('nope', { status: 500 })
    : new Response(JSON.stringify({ version: serverVersion }), { status: 200 })
))

function setup(known: number | null) {
  const ref = { current: known }
  const reload = vi.fn()
  const hook = renderHook(() => useBoardFreshness(PROJECT_ID, ref, reload))
  return { ref, reload, hook }
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

beforeEach(() => {
  vi.useFakeTimers()
  dirty = false
  serverVersion = 5
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useBoardFreshness', () => {
  it('reloads when the on-screen version is unknown instead of adopting the server one', async () => {
    const { reload, hook } = setup(null)
    await act(async () => { await hook.result.current.checkNow() })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the server matches what is on screen', async () => {
    const { reload, hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    expect(fetchMock).toHaveBeenCalledWith(`/api/sync/version/${PROJECT_ID}`, { cache: 'no-store' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when the server moved on', async () => {
    serverVersion = 9
    const { reload, hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['window focus', () => window.dispatchEvent(new Event('focus'))],
    ['page restored from cache', () => window.dispatchEvent(new Event('pageshow'))],
    ['network back', () => window.dispatchEvent(new Event('online'))],
    ['tab unfrozen', () => document.dispatchEvent(new Event('resume'))],
    ['tab shown', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('checks on %s', async (_label, fire) => {
    serverVersion = 6
    const { reload } = setup(5)
    act(() => { fire() })
    await flush()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('polls on an interval', async () => {
    serverVersion = 6
    const { reload } = setup(5)
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('skips hidden tabs', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    serverVersion = 6
    const { reload, hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('retries soon instead of dropping the check while edits are in flight', async () => {
    serverVersion = 6
    dirty = true
    const { reload, hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    expect(fetchMock).not.toHaveBeenCalled()
    dirty = false
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MS) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('retries soon when the version check fails', async () => {
    serverVersion = null
    const { reload, hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    expect(reload).not.toHaveBeenCalled()
    serverVersion = 6
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MS) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('recheckSoon runs one check after the delay', async () => {
    serverVersion = 6
    const { reload, hook } = setup(5)
    act(() => { hook.result.current.recheckSoon(); hook.result.current.recheckSoon() })
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('backs off when the version check keeps failing', async () => {
    serverVersion = null
    const { hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(RECHECK_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does nothing after the board is left', async () => {
    serverVersion = 6
    dirty = true
    const { reload, hook } = setup(5)
    await act(async () => { await hook.result.current.checkNow() })
    hook.unmount()
    dirty = false
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('drops a check that finishes after switching to another board', async () => {
    serverVersion = 6
    const ref = { current: 5 as number | null }
    const reload = vi.fn()
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r }))
    const hook = renderHook(({ id }) => useBoardFreshness(id, ref, reload), { initialProps: { id: 'p1' } })
    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = hook.result.current.checkNow() })
    hook.rerender({ id: 'p2' })
    await act(async () => {
      release(new Response(JSON.stringify({ version: 6 }), { status: 200 }))
      await pending
    })
    expect(reload).not.toHaveBeenCalled()
  })
})
