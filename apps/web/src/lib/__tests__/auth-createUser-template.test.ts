import { beforeEach, describe, expect, it, vi } from 'vitest'

type CreateUserEvent = (payload: { user: { id?: string; email?: string | null } }) => Promise<void>

const { captured } = vi.hoisted(() => ({
  captured: { config: null as { events: { createUser: (payload: { user: { id?: string; email?: string | null } }) => Promise<void> } } | null },
}))

vi.mock('next-auth', () => ({
  default: vi.fn((config: { events: { createUser: CreateUserEvent } }) => {
    captured.config = config
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }
  }),
}))
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: vi.fn(() => ({})) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({ id: 'google' })) }))
vi.mock('@/lib/db', () => ({ db: { update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })) } }))
vi.mock('@/lib/db/schema', () => ({
  users: new Proxy({}, { get: () => ({}) }),
  accounts: {},
  sessions: {},
  verificationTokens: {},
}))
vi.mock('@/lib/data/workspaces', () => ({
  hasValidPendingInvite: vi.fn(async () => true),
  resolveUserPendingInvites: vi.fn(async () => undefined),
}))
vi.mock('@/lib/data/settingsTemplates', () => ({ applyDefaultTemplateToUser: vi.fn(async () => undefined) }))

import '../auth'
import { applyDefaultTemplateToUser } from '@/lib/data/settingsTemplates'
import { resolveUserPendingInvites } from '@/lib/data/workspaces'

const mockApply = vi.mocked(applyDefaultTemplateToUser)
const mockInvites = vi.mocked(resolveUserPendingInvites)

function createUser(user: { id?: string; email?: string | null }) {
  if (!captured.config) throw new Error('NextAuth config was not captured')
  return captured.config.events.createUser({ user })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('auth createUser event — defaults template', () => {
  it('applies the default template to a brand-new account', async () => {
    await createUser({ id: 'user-1', email: 'new@aeon.app' })
    expect(mockApply).toHaveBeenCalledWith('user-1')
  })

  it('never breaks account creation when the template lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApply.mockRejectedValueOnce(new Error('db down'))
    await expect(createUser({ id: 'user-2', email: 'new@aeon.app' })).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('still resolves pending invites alongside the template', async () => {
    await createUser({ id: 'user-3', email: 'invited@aeon.app' })
    expect(mockInvites).toHaveBeenCalledWith('user-3', 'invited@aeon.app')
    expect(mockApply).toHaveBeenCalledWith('user-3')
  })
})
