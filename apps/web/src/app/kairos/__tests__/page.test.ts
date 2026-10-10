import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const permanentRedirect = vi.fn()
const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND') })
vi.mock('next/navigation', () => ({
  permanentRedirect: (url: string) => permanentRedirect(url),
  notFound: () => notFound(),
}))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

import { auth } from '@/lib/auth'
import KairosRedirect from '../page'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: 'owner' }, expires: '2099-01-01' } as never)
})

afterEach(() => vi.unstubAllEnvs())

describe('/kairos', () => {
  it('permanently redirects to /vorath', async () => {
    await KairosRedirect({ searchParams: Promise.resolve({}) })
    expect(permanentRedirect).toHaveBeenCalledWith('/vorath')
  })

  it('keeps the query string', async () => {
    await KairosRedirect({ searchParams: Promise.resolve({ memory: 'm1', tag: ['a', 'b'] }) })
    expect(permanentRedirect).toHaveBeenCalledWith('/vorath?memory=m1&tag=a&tag=b')
  })

  it('404s a beta tester instead of revealing /vorath', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VORATH_USER_IDS', 'owner')
    vi.mocked(auth).mockResolvedValue({ user: { id: 'tester' }, expires: '2099-01-01' } as never)
    await expect(KairosRedirect({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(permanentRedirect).not.toHaveBeenCalled()
  })
})
