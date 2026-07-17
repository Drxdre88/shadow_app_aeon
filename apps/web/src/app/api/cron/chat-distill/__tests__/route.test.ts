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

import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runChatDistillForUser } from '@/lib/kairos/chat-distill'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
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
})
