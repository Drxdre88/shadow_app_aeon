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

import { requireAuth, requireOwnership, requireEditor } from '../helpers'
import { auth } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/data/projects'

const mockAuth = vi.mocked(auth)
const mockVerifyProjectAccess = vi.mocked(verifyProjectAccess)

const SESSION_USER_ID = 'user-abc'
const PROJECT_ID = 'proj-xyz'

const makeSession = (id: string | undefined = SESSION_USER_ID) => ({
  user: id !== undefined ? { id } : {},
  expires: '2099-01-01',
})

const makeProject = (userId = SESSION_USER_ID) => ({
  id: PROJECT_ID,
  userId,
  name: 'Test Project',
  description: null,
  timeScale: 'weekly',
  startDate: null,
  endDate: null,
  settings: null,
  group: null,
  planetImage: null,
  boardVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const makeAccess = (role: string, userId = SESSION_USER_ID) => ({
  project: makeProject(userId),
  role,
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('requireAuth', () => {
  it('returns userId when session exists with valid user id', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    const result = await requireAuth()
    expect(result).toBe(SESSION_USER_ID)
  })

  it('throws Unauthorized when auth returns null', async () => {
    mockAuth.mockResolvedValue(null as never)
    await expect(requireAuth()).rejects.toThrow('Unauthorized')
  })

  it('throws Unauthorized when session has no user property', async () => {
    mockAuth.mockResolvedValue({ expires: '2099-01-01' } as never)
    await expect(requireAuth()).rejects.toThrow('Unauthorized')
  })

  it('throws Unauthorized when session.user has no id', async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: '2099-01-01' } as never)
    await expect(requireAuth()).rejects.toThrow('Unauthorized')
  })
})

describe('requireOwnership', () => {
  it('returns userId when authenticated and project is found', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(makeAccess('owner') as never)

    const result = await requireOwnership(PROJECT_ID)

    expect(result).toBe(SESSION_USER_ID)
    expect(mockVerifyProjectAccess).toHaveBeenCalledWith(PROJECT_ID, SESSION_USER_ID)
  })

  it('throws Unauthorized when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)
    await expect(requireOwnership(PROJECT_ID)).rejects.toThrow('Unauthorized')
  })

  it('throws when project not found or user has no access', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(null as never)

    await expect(requireOwnership(PROJECT_ID)).rejects.toThrow(
      'Project not found or unauthorized'
    )
  })
})

describe('requireEditor', () => {
  it('returns userId for owner role', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(makeAccess('owner') as never)

    const result = await requireEditor(PROJECT_ID)

    expect(result).toBe(SESSION_USER_ID)
  })

  it('returns userId for editor role', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(makeAccess('editor', 'other-user') as never)

    const result = await requireEditor(PROJECT_ID)

    expect(result).toBe(SESSION_USER_ID)
  })

  it('returns userId for admin role', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(makeAccess('admin', 'other-user') as never)

    const result = await requireEditor(PROJECT_ID)

    expect(result).toBe(SESSION_USER_ID)
  })

  it('throws when role is viewer', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(makeAccess('viewer', 'other-user') as never)

    await expect(requireEditor(PROJECT_ID)).rejects.toThrow(
      'Viewers cannot modify this project'
    )
  })

  it('throws Unauthorized when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)
    await expect(requireEditor(PROJECT_ID)).rejects.toThrow('Unauthorized')
  })

  it('throws when project not found', async () => {
    mockAuth.mockResolvedValue(makeSession() as never)
    mockVerifyProjectAccess.mockResolvedValue(null as never)

    await expect(requireEditor(PROJECT_ID)).rejects.toThrow(
      'Project not found or unauthorized'
    )
  })
})
