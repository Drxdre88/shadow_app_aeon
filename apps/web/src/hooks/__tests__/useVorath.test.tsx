/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useVorath } from '../useVorath'
import { vorathSession } from '../testing/vorathSession'

describe('useVorath', () => {
  it('is true for the allowlisted owner', () => {
    const { result } = renderHook(() => useVorath(), { wrapper: vorathSession('owner') })
    expect(result.current).toBe(true)
  })

  it('is false for a beta tester', () => {
    const { result } = renderHook(() => useVorath(), { wrapper: vorathSession('tester') })
    expect(result.current).toBe(false)
  })

  it('is false while the session is loading', () => {
    const { result } = renderHook(() => useVorath(), { wrapper: vorathSession('loading') })
    expect(result.current).toBe(false)
  })

  it('is false outside a SessionProvider instead of throwing', () => {
    const { result } = renderHook(() => useVorath())
    expect(result.current).toBe(false)
  })
})
