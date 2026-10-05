import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-auth', () => ({ default: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('../helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/data/brain-status', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/brain-status')>()
  return { ...actual, listBrainJobsSince: vi.fn(), getSetupSignals: vi.fn() }
})
vi.mock('@/lib/kairos/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kairos/telegram')>()
  return { ...actual, sendMessage: vi.fn() }
})
vi.mock('@/lib/api/rateLimit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ findOwnProjects: vi.fn() }))
vi.mock('@/lib/data/kairos-paid-backup', () => ({ getPaidBackupSetting: vi.fn(), setPaidBackupSetting: vi.fn() }))
vi.mock('@/lib/data/character', () => ({ listCharacterRuns: vi.fn(async () => []) }))
vi.mock('@/lib/data/dominions', () => ({
  findDominionsByUser: vi.fn(),
  listReposForUser: vi.fn(),
  listRecentCaptureRepos: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getSetupSignals, listBrainJobsSince } from '@/lib/data/brain-status'
import { sendMessage } from '@/lib/kairos/telegram'
import { checkRateLimit } from '@/lib/api/rateLimit'
import { findOwnProjects } from '@/lib/data/projects'
import { getPaidBackupSetting, setPaidBackupSetting } from '@/lib/data/kairos-paid-backup'
import { findDominionsByUser, listReposForUser, listRecentCaptureRepos } from '@/lib/data/dominions'
import { requireAuth } from '../helpers'
import { getKairosBrainStatus, getKairosWatchedOverview, getPaidBackup, sendKairosTestMessage, setPaidBackup } from '../kairos-brain'

const ENV_KEYS = [
  'AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL',
  'KAIROS_TELEGRAM_ROUTINE', 'KAIROS_CHAT_ROUTINE', 'KAIROS_OPERATOR_USER_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OPERATOR_CHAT_ID',
  'ROUTINE_CHAT_ID', 'ROUTINE_CHAT_TOKEN', 'ROUTINE_CHAT_FIRE_URL',
] as const
const saved: Record<string, string | undefined> = {}
const SETUP = {
  connectorUsedAt: '2026-10-01T09:00:00.000Z',
  sessions: { claude: '2026-10-02T07:00:00.000Z', codex: null, copilot: null },
  voiceNoteAt: null,
  watchedBoards: 2,
  telegramConfigured: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  vi.mocked(requireAuth).mockResolvedValue('user-1')
  vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', role: 'admin' } } as never)
  vi.mocked(listBrainJobsSince).mockResolvedValue([])
  vi.mocked(getSetupSignals).mockResolvedValue(SETUP)
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 2, resetAt: 0 })
  vi.mocked(sendMessage).mockResolvedValue({ messageId: 1 })
  vi.mocked(getPaidBackupSetting).mockResolvedValue(true)
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

  it('reports the caller\'s paid-backup switch and last-7-day backup count', async () => {
    const now = Date.now()
    const at = (msAgo: number) => new Date(now - msAgo)
    vi.mocked(listBrainJobsSince).mockResolvedValue([
      { kind: 'concept', status: 'fallback', claimedBy: null, claimedAt: null, completedAt: at(3600_000), deadlineAt: at(7200_000), error: null },
      { kind: 'cortex', status: 'failed', claimedBy: null, claimedAt: null, completedAt: null, deadlineAt: at(7200_000), error: 'deadline_passed: …; the cortex-regen cron owns this job now' },
      { kind: 'aether', status: 'done', claimedBy: 'routine', claimedAt: at(7200_000), completedAt: at(7000_000), deadlineAt: at(6000_000), error: null },
    ])
    const on = await getKairosBrainStatus()
    expect(getPaidBackupSetting).toHaveBeenCalledWith('user-1')
    expect(on.paidBackup).toEqual({ enabled: true, paidCallsLast7d: 2 })

    // Off: a cron-"covered" job was skipped by its cron, so it is missed, not paid.
    vi.mocked(getPaidBackupSetting).mockResolvedValue(false)
    const off = await getKairosBrainStatus()
    expect(off.paidBackup).toEqual({ enabled: false, paidCallsLast7d: 1 })
    expect(off.lastNight.missed).toBe(on.lastNight.missed + 1)
  })

  it('passes 7-day chat latency through (null with no chat turns)', async () => {
    expect((await getKairosBrainStatus()).chatLatency).toBeNull()

    const now = Date.now()
    const at = (msAgo: number) => new Date(now - msAgo)
    vi.mocked(listBrainJobsSince).mockResolvedValue([
      { kind: 'chat', status: 'done', claimedBy: 'routine', createdAt: at(3_600_000), claimedAt: at(3_595_000), completedAt: at(3_562_000), deadlineAt: at(3_500_000), error: null, timing: { fireOk: true } },
      { kind: 'chat', status: 'failed', claimedBy: null, createdAt: at(7_200_000), claimedAt: null, completedAt: at(7_140_000), deadlineAt: at(7_100_000), error: 'chat-watchdog: no claim; answered on the paid key', timing: { fireOk: false, enqueueToSettleMs: 90_000 } },
    ])
    const s = await getKairosBrainStatus()
    expect(s.chatLatency).toMatchObject({ turns: 2, routine: 1, backup: 1, p50Ms: 38_000, backupP50Ms: 90_000, fireFailures: 1, lastTurnMs: 38_000 })
  })
})

describe('setup signals in getKairosBrainStatus', () => {
  it('passes the caller through and returns the signals as-is', async () => {
    const s = await getKairosBrainStatus()
    expect(s.setup).toEqual(SETUP)
    const [userId, opts] = vi.mocked(getSetupSignals).mock.calls[0]!
    expect(userId).toBe('user-1')
    expect(opts?.isOperator).toBe(true) // admin, no operator id configured
  })

  it('only the configured operator counts as operator', async () => {
    process.env.KAIROS_OPERATOR_USER_ID = 'user-op'
    await getKairosBrainStatus()
    expect(vi.mocked(getSetupSignals).mock.calls[0]![1]?.isOperator).toBe(false)
    vi.mocked(requireAuth).mockResolvedValue('user-op')
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-op', role: 'user' } } as never)
    await getKairosBrainStatus()
    expect(vi.mocked(getSetupSignals).mock.calls[1]![1]?.isOperator).toBe(true)
  })
})

describe('sendKairosTestMessage', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
    process.env.TELEGRAM_OPERATOR_CHAT_ID = '4242'
  })

  it('rejects when signed out and sends nothing', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(sendKairosTestMessage()).rejects.toThrow('Unauthorized')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends one plain line to the operator chat — no inbox, no speak', async () => {
    expect(await sendKairosTestMessage()).toEqual({ ok: true })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith('4242', 'Vorath test — if you can read this, Telegram is connected ✓')
    expect(checkRateLimit).toHaveBeenCalledWith('kairos-telegram-test:user-1', expect.any(Object))
  })

  it('refuses a non-admin when no operator is configured', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', role: 'user' } } as never)
    const out = await sendKairosTestMessage()
    expect(out.ok).toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('refuses an admin who is not the configured operator', async () => {
    process.env.KAIROS_OPERATOR_USER_ID = 'someone-else'
    expect((await sendKairosTestMessage()).ok).toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('reports a missing bot setup without calling Telegram', async () => {
    delete process.env.TELEGRAM_OPERATOR_CHAT_ID
    const out = await sendKairosTestMessage()
    expect(out).toEqual({ ok: false, error: expect.stringContaining('not set up') })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: 0 })
    expect((await sendKairosTestMessage()).ok).toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('turns a Telegram failure into an error without leaking it', async () => {
    vi.mocked(sendMessage).mockRejectedValue(new Error('Telegram sendMessage failed (401): Unauthorized bot-token'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await sendKairosTestMessage()
    spy.mockRestore()
    expect(out.ok).toBe(false)
    expect(out.error).not.toContain('bot-token')
  })
})

describe('paid backup actions', () => {
  it('require auth and never touch the store when signed out', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(setPaidBackup(false)).rejects.toThrow('Unauthorized')
    await expect(getPaidBackup()).rejects.toThrow('Unauthorized')
    expect(setPaidBackupSetting).not.toHaveBeenCalled()
    expect(getPaidBackupSetting).not.toHaveBeenCalled()
  })

  it('write the caller\'s switch and echo it', async () => {
    vi.mocked(setPaidBackupSetting).mockResolvedValue(false)
    expect(await setPaidBackup(false)).toEqual({ enabled: false })
    expect(setPaidBackupSetting).toHaveBeenCalledWith('user-1', false)
    expect(await getPaidBackup()).toEqual({ enabled: true })
  })

  it('reject a non-boolean', async () => {
    await expect(setPaidBackup('no' as never)).rejects.toThrow()
    expect(setPaidBackupSetting).not.toHaveBeenCalled()
  })
})

describe('getKairosWatchedOverview', () => {
  beforeEach(() => {
    vi.mocked(findOwnProjects).mockResolvedValue([
      { id: 'p-1', name: 'Zeta', settings: {}, dominionId: null },
      { id: 'p-2', name: 'AS Sprint', settings: { kairosFeed: 'daily' }, dominionId: 'd-1' },
      { id: 'p-3', name: 'STP Sprint', settings: { kairosFeed: 'weekly', boardTheme: 'x' }, dominionId: 'd-gone' },
    ] as never)
    vi.mocked(findDominionsByUser).mockResolvedValue([
      { id: 'd-1', name: 'KAIROS', color: 'purple', archivedAt: null },
      { id: 'd-old', name: 'Old', color: 'blue', archivedAt: new Date() },
    ] as never)
    vi.mocked(listReposForUser).mockResolvedValue([{ dominionId: 'd-1', repoSlug: 'shadow_app_aeon' }])
    vi.mocked(listRecentCaptureRepos).mockResolvedValue([
      { repo: 'shadow_app_aeon', captures: 9, lastAt: new Date('2026-10-02T08:00:00Z') },
      { repo: 'swarm', captures: 3, lastAt: new Date('2026-10-01T08:00:00Z') },
    ])
  })

  it('rejects when unauthenticated and never queries', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(getKairosWatchedOverview()).rejects.toThrow('Unauthorized')
    expect(findOwnProjects).not.toHaveBeenCalled()
  })

  it("lists the caller's own boards watched-first, live areas with repos, and unmapped recent repos", async () => {
    const out = await getKairosWatchedOverview()
    expect(findOwnProjects).toHaveBeenCalledWith('user-1')
    expect(out.projects).toEqual([
      { id: 'p-2', name: 'AS Sprint', feed: 'daily', areaName: 'KAIROS' },
      { id: 'p-3', name: 'STP Sprint', feed: 'weekly', areaName: null },
      { id: 'p-1', name: 'Zeta', feed: null, areaName: null },
    ])
    expect(out.areas).toEqual([{ id: 'd-1', name: 'KAIROS', color: 'purple', repos: ['shadow_app_aeon'] }])
    expect(out.unmappedRepos).toEqual([{ repo: 'swarm', captures: 3, lastAt: '2026-10-01T08:00:00.000Z' }])
    const [, since] = vi.mocked(listRecentCaptureRepos).mock.calls[0]!
    expect(Date.now() - since.getTime()).toBeLessThan(14 * 86_400_000 + 5000)
  })
})
