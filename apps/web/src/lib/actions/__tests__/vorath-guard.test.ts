import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ verifyProjectAccess: vi.fn() }))
vi.mock('@/lib/data/ai-done', () => ({ findAiDoneBoard: vi.fn(), setProjectAiDone: vi.fn() }))

import { auth } from '@/lib/auth'
import { verifyProjectAccess } from '@/lib/data/projects'
import { findAiDoneBoard, setProjectAiDone } from '@/lib/data/ai-done'
import { requireVorath } from '../helpers'
import { getAiDoneSetting, setAiDone } from '../ai-done'

const signIn = (id: string) => vi.mocked(auth).mockResolvedValue({ user: { id }, expires: '2099-01-01' } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VORATH_USER_IDS', 'owner')
  vi.mocked(verifyProjectAccess).mockResolvedValue({ role: 'owner' } as never)
  vi.mocked(findAiDoneBoard).mockResolvedValue({ id: 'p1', userId: 'owner', settings: { kairosAiDone: true } })
})

afterEach(() => vi.unstubAllEnvs())

describe('requireVorath', () => {
  it('refuses a signed-in beta tester with a generic error', async () => {
    signIn('tester')
    await expect(requireVorath()).rejects.toThrow('Not found')
  })

  it('refuses a signed-out caller as unauthorized', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    await expect(requireVorath()).rejects.toThrow('Unauthorized')
  })

  it('lets the owner through', async () => {
    signIn('owner')
    await expect(requireVorath()).resolves.toBe('owner')
  })
})

describe('board Vorath switches for a beta tester who owns the board', () => {
  it('reads as off without touching the board row', async () => {
    signIn('tester')
    expect(await getAiDoneSetting('p1')).toEqual({ on: false, canToggle: false, available: false })
    expect(findAiDoneBoard).not.toHaveBeenCalled()
  })

  it('refuses to switch on and writes nothing', async () => {
    signIn('tester')
    await expect(setAiDone('p1', true)).rejects.toThrow('Not found')
    expect(setProjectAiDone).not.toHaveBeenCalled()
  })

  it('still works for the owner', async () => {
    signIn('owner')
    vi.mocked(setProjectAiDone).mockResolvedValue({ id: 'p1', settings: { kairosAiDone: true } })
    expect(await setAiDone('p1', true)).toEqual({ projectId: 'p1', on: true })
  })
})
