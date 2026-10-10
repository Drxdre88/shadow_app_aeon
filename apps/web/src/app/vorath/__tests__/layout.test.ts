import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND') })
const redirect = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) })
vi.mock('next/navigation', () => ({ notFound: () => notFound(), redirect: (url: string) => redirect(url) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/actions/projects', () => ({ getWorkspaceProjects: vi.fn(async () => []) }))
vi.mock('@/lib/actions/workspaces', () => ({ ensurePersonalWorkspace: vi.fn(async () => undefined) }))
vi.mock('@/components/kairos/KairosShell', () => ({ KairosShell: () => null }))

import { auth } from '@/lib/auth'
import { getWorkspaceProjects } from '@/lib/actions/projects'
import VorathLayout from '../layout'

const signIn = (id: string) =>
  vi.mocked(auth).mockResolvedValue({ user: { id, termsAccepted: true }, expires: '2099-01-01' } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VORATH_USER_IDS', 'owner')
})

afterEach(() => vi.unstubAllEnvs())

describe('/vorath layout', () => {
  it('404s a signed-in beta tester before loading anything', async () => {
    signIn('tester')
    await expect(VorathLayout({ children: null })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledTimes(1)
    expect(getWorkspaceProjects).not.toHaveBeenCalled()
  })

  it('still sends a signed-out visitor to login', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    await expect(VorathLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT /login')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('renders for the owner', async () => {
    signIn('owner')
    await expect(VorathLayout({ children: null })).resolves.toBeTruthy()
    expect(notFound).not.toHaveBeenCalled()
  })
})
