import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-chat', () => ({
  listChatDistillEligibleUserIds: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-distill', () => ({
  runChatDistillForUser: vi.fn(),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

vi.mock('@/lib/kairos/paid-backup-cron', () => ({
  skipCronIfPaidBackupOff: vi.fn(async () => false),
}))

vi.mock('@/lib/data/kairos-today', () => ({
  markTodayConsumed: vi.fn(async () => 1),
  purgeTodayEntries: vi.fn(async () => 3),
}))

import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { markTodayConsumed, purgeTodayEntries } from '@/lib/data/kairos-today'
import { runChatDistillForUser } from '@/lib/kairos/chat-distill'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { skipCronIfPaidBackupOff } from '@/lib/kairos/paid-backup-cron'
import { GET } from '../route'

function request(authorization?: string) {
  return {
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/chat-distill route', () => {
  it('returns 401 without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(listChatDistillEligibleUserIds).not.toHaveBeenCalled()
  })

  it('runs each eligible user and totals created reflections', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1'])
    ;(runChatDistillForUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: '2026-07-16',
      dryRun: false,
      reflectionsCreated: 2,
      threads: [],
    })

    const response = await GET(request('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ran: 1, skipped: 0, reflectionsCreated: 2 })
    expect(runChatDistillForUser).toHaveBeenCalledWith('user-1')
  })

  it('paid backup off: skips the user without distilling', async () => {
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1'])
    vi.mocked(skipCronIfPaidBackupOff).mockResolvedValueOnce(true)

    const body = await (await GET(request())).json()

    expect(skipCronIfPaidBackupOff).toHaveBeenCalledWith('user-1', 'chat-distill')
    expect(runChatDistillForUser).not.toHaveBeenCalled()
    expect(body).toMatchObject({ ran: 0, paidBackupOff: ['user-1'] })
  })

  it('skips remaining users once the deadline is reached', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1', 'user-2'])
    ;(runChatDistillForUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: '2026-07-16',
      dryRun: false,
      reflectionsCreated: 1,
      threads: [],
    })
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)        // startedAt
      .mockReturnValueOnce(0)        // user-1 deadline check → runs
      .mockReturnValue(300_000)      // user-2 deadline check → skipped

    const response = await GET(request('Bearer cron-secret'))
    const body = await response.json()
    nowSpy.mockRestore()

    expect(body).toMatchObject({ ran: 1, skipped: 1, skippedUserIds: ['user-2'] })
    expect(runChatDistillForUser).toHaveBeenCalledTimes(1)
    expect(runChatDistillForUser).toHaveBeenCalledWith('user-1')
  })

  it('isolates a per-user failure, traces it, and continues to the next user', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1', 'user-2'])
    ;(runChatDistillForUser as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ date: '2026-07-16', dryRun: false, reflectionsCreated: 3, threads: [] })

    const response = await GET(request('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ran).toBe(2)
    expect(body.users[0].error).toBe('boom')
    expect(body.users[1].result).toMatchObject({ reflectionsCreated: 3 })
    expect(writeCronFailureTrace).toHaveBeenCalledTimes(1)
  })

  it('continues to the next user even when the trace write itself fails', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1', 'user-2'])
    ;(runChatDistillForUser as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ date: '2026-07-16', dryRun: false, reflectionsCreated: 1, threads: [] })
    ;(writeCronFailureTrace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('trace write failed'))

    const response = await GET(request('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ran).toBe(2)
    expect(body.users[1].result).toMatchObject({ reflectionsCreated: 1 })
  })

  it('marks the today log consumed through the start of the UTC day, then purges it', async () => {
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1'])
    ;(runChatDistillForUser as ReturnType<typeof vi.fn>).mockResolvedValue({ date: '2026-07-16', dryRun: false, reflectionsCreated: 0, threads: [] })

    const body = await (await GET(request())).json()

    expect(markTodayConsumed).toHaveBeenCalledTimes(1)
    const through = vi.mocked(markTodayConsumed).mock.calls[0][0] as Date
    expect(through.toISOString()).toMatch(/T00:00:00\.000Z$/)
    expect(purgeTodayEntries).toHaveBeenCalledTimes(1)
    expect(vi.mocked(markTodayConsumed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(purgeTodayEntries).mock.invocationCallOrder[0])
    expect(body.today).toEqual({ consumed: 1, purged: 3 })
  })

  it('never fails the cron when the today trim throws', async () => {
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue([])
    vi.mocked(purgeTodayEntries).mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.today).toEqual({ error: 'db down' })
  })
})
