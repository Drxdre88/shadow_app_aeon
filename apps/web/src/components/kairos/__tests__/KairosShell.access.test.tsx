/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { vorathSession } from '@/hooks/testing/vorathSession'

vi.mock('next-auth/react', async (importOriginal) => ({ ...(await importOriginal<typeof import('next-auth/react')>()), signOut: vi.fn() }))
vi.mock('@/components/sidebar/AppSidebar', () => ({ AppSidebar: () => <aside data-testid="sidebar" /> }))
vi.mock('@/components/kairos/KairosVisor', () => ({ KairosVisor: () => <div data-testid="visor" /> }))
vi.mock('@/components/kairos/KairosVisorToggle', () => ({ KairosVisorToggle: () => <button data-testid="visor-toggle" /> }))

import { KairosShell } from '../KairosShell'

const user = { id: 'u1', role: 'user' }

afterEach(cleanup)

describe('KairosShell visor access', () => {
  it('mounts the Vorath visor and its toggle for the owner', () => {
    render(<KairosShell user={user} initialWorkspaces={[]}><p>page</p></KairosShell>, { wrapper: vorathSession('owner') })
    expect(screen.getByTestId('visor')).toBeTruthy()
    expect(screen.getByTestId('visor-toggle')).toBeTruthy()
  })

  it('mounts neither for a beta tester but keeps the page and sidebar', () => {
    render(<KairosShell user={user} initialWorkspaces={[]}><p>page</p></KairosShell>, { wrapper: vorathSession('tester') })
    expect(screen.queryByTestId('visor')).toBeNull()
    expect(screen.queryByTestId('visor-toggle')).toBeNull()
    expect(screen.getByText('page')).toBeTruthy()
    expect(screen.getByTestId('sidebar')).toBeTruthy()
  })
})
