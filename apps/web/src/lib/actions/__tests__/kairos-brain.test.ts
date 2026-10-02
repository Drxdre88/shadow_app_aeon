import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-auth', () => ({ default: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('../helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/data/brain-status', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/brain-status')>()
  return { ...actual, listBrainJobsSince: vi.fn() }
})

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { listBrainJobsSince } from '@/lib/data/brain-status'
import { requireAuth } from '../helpers'
import { getKairosBrainStatus } from '../kairos-brain'

const ENV_KEYS = [
  'AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL',
  'KAIROS_TELEGRAM_ROUTINE', 'ROUTINE_CHAT_ID', 'ROUTINE_CHAT_TOKEN', 'ROUTINE_CHAT_FIRE_URL',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  vi.mocked(requireAuth).mockResolvedValue('user-1')
  vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', role: 'admin' } } as never)
  vi.mocked(listBrainJobsSince).mockResolvedValue([])
  vi.mocked(headers).mockResolvedValue(new Headers({ host: 'preview.example.app' }) as never)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('getKairosBrainStatus', () => {
  it('rejects when unauthenticated and never queries', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(getKairosBrainStatus()).rejects.toThrow('Unauthorized')
    expect(listBrainJobsSince).not.toHaveBeenCalled()
  })

  it('scopes the query to the caller over the last 7 days', async () => {
    await getKairosBrainStatus()
    const [userId, since] = vi.mocked(listBrainJobsSince).mock.calls[0]
    expect(userId).toBe('user-1')
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(7 * 24 * 3600_000 - 1000)
    expect(Date.now() - since.getTime()).toBeLessThan(7 * 24 * 3600_000 + 5000)
  })

  it('uses the configured app URL for appUrl and the MCP endpoint', async () => {
    process.env.AUTH_URL = 'https://aeon.example.com/'
    const s = await getKairosBrainStatus()
    expect(s.appUrl).toBe('https://aeon.example.com')
    expect(s.mcpUrl).toBe('https://aeon.example.com/api/mcp')
  })

  it('falls back to the request host when no URL is configured', async () => {
    const s = await getKairosBrainStatus()
    expect(s.appUrl).toBe('https://preview.example.app')
    expect(s.mcpUrl).toBe('https://preview.example.app/api/mcp')
  })

  it('reports the Telegram routine flag and config as booleans, never the secrets', async () => {
    process.env.KAIROS_TELEGRAM_ROUTINE = '1'
    process.env.ROUTINE_CHAT_ID = 'trig_secret_id'
    process.env.ROUTINE_CHAT_TOKEN = 'sk-secret-token'
    const s = await getKairosBrainStatus()
    expect(s.telegram).toEqual({ routineFlagOn: true, routineConfigured: true })
    expect(s.routines.find((r) => r.id === 'chat')?.state).toBe('silent')
    const json = JSON.stringify(s)
    expect(json).not.toContain('trig_secret_id')
    expect(json).not.toContain('sk-secret-token')
  })

  it('flag off and unconfigured: chat routine off, not configured', async () => {
    const s = await getKairosBrainStatus()
    expect(s.telegram).toEqual({ routineFlagOn: false, routineConfigured: false })
    expect(s.routines.find((r) => r.id === 'chat')?.state).toBe('off')
  })

  it('isAdmin follows the session role', async () => {
    expect((await getKairosBrainStatus()).isAdmin).toBe(true)
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', role: 'user' } } as never)
    expect((await getKairosBrainStatus()).isAdmin).toBe(false)
  })
})
