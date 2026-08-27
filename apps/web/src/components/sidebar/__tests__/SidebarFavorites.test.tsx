/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// The hide toggle used to be a <span role="button"> nested INSIDE the row's
// navigation <button>. Nested interactive elements are invalid HTML: browsers
// reparent them, and assistive tech announces one control where there are two.
// It is now a real sibling button positioned over the row.

const push = vi.fn()
const prefetch = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push, prefetch }),
}))
const FAVORITES = [
  { id: 'p-1', name: 'Aeon', favoritedAt: 1 },
  { id: 'p-2', name: 'Kairos', favoritedAt: 2 },
]
vi.mock('@/lib/actions/projects', () => ({
  getFavoriteProjects: vi.fn(() => Promise.resolve(FAVORITES)),
}))

import { SidebarFavorites } from '../SidebarFavorites'
import { useFavoritesStore } from '@/stores/favoritesStore'
import { useSidebarStore } from '@/stores/sidebarStore'

beforeEach(() => {
  useFavoritesStore.setState({ entries: FAVORITES })
  useSidebarStore.setState({ hiddenProjectIds: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderFavorites() {
  const view = render(<SidebarFavorites collapsed={false} />)
  await act(async () => {})
  return view
}

const hideButton = (name: string) => screen.getByRole('button', { name: `Hide ${name} from sidebar` })

describe('SidebarFavorites — hide toggle', () => {
  it('is a real button, not nested inside the navigation button', async () => {
    await renderFavorites()
    const hide = hideButton('Aeon')
    expect(hide.tagName).toBe('BUTTON')
    // The killer assertion: no <button> ancestor anywhere above it.
    expect(hide.parentElement?.closest('button')).toBeNull()
  })

  it('hides the row without navigating', async () => {
    await renderFavorites()
    act(() => { fireEvent.click(hideButton('Kairos')) })

    expect(useSidebarStore.getState().hiddenProjectIds).toEqual(['p-2'])
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByText('Kairos')).toBeNull()
    expect(screen.getByText('Aeon')).toBeTruthy()
  })

  it('the row itself still navigates', async () => {
    await renderFavorites()
    act(() => { fireEvent.click(screen.getByText('Aeon')) })
    expect(push).toHaveBeenCalledWith('/project/p-1')
  })
})
