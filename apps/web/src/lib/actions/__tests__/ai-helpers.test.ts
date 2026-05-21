import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next-auth', () => ({ default: vi.fn() }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }))
vi.mock('next/server', () => ({ NextResponse: { json: vi.fn(), redirect: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/schema', () => ({}))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({
  verifyProjectAccess: vi.fn(),
  verifyProjectOwnership: vi.fn(),
  getMemberRole: vi.fn(),
}))

import { requireAiAccess } from '../helpers'
import { AiForbiddenError } from '../errors'
import { auth } from '@/lib/auth'

const mockAuth = vi.mocked(auth)

describe('requireAiAccess', () => {
  beforeEach(() => {
    mockAuth.mockReset()
  })

  it('returns userId when session role is admin', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin' },
      expires: '2099-01-01',
    } as never)
    await expect(requireAiAccess()).resolves.toBe('admin-1')
  })

  it('throws AiForbiddenError when session role is user', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'user' },
      expires: '2099-01-01',
    } as never)
    await expect(requireAiAccess()).rejects.toBeInstanceOf(AiForbiddenError)
  })

  it('throws AiForbiddenError when role is missing', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2' },
      expires: '2099-01-01',
    } as never)
    await expect(requireAiAccess()).rejects.toBeInstanceOf(AiForbiddenError)
  })

  it('throws Unauthorized when no session', async () => {
    mockAuth.mockResolvedValue(null as never)
    await expect(requireAiAccess()).rejects.toThrow(/unauthorized/i)
  })

  it('throws Unauthorized when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: '2099-01-01' } as never)
    await expect(requireAiAccess()).rejects.toThrow(/unauthorized/i)
  })
})
