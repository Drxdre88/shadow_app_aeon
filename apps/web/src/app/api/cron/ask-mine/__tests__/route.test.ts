import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/kairos-chat', () => ({
  listChatDistillEligibleUserIds: vi.fn(),
}))

vi.mock('@/lib/kairos/ask-mine', () => ({
  runAskMineForUser: vi.fn(),
  sweepExpiredKairosAsks: vi.fn(async () => ({ examined: 0, expired: 0 })),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

vi.mock('@/lib/kairos/paid-backup-cron', () => ({
  skipCronIfPaidBackupOff: vi.fn(async () => false),
}))

import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runAskMineForUser, sweepExpiredKairosAsks } from '@/lib/kairos/ask-mine'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { skipCronIfPaidBackupOff } from '@/lib/kairos/paid-backup-cron'
import { GET } from '../route'

function request(path = '/api/cron/ask-mine', authorization?: string) {
  return {
    url: `https://aeon.test${path}`,
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/ask-mine route', () => {
  it('paid backup off: still sweeps expired asks but never runs the paid ask', async () => {
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1'])
    vi.mocked(skipCronIfPaidBackupOff).mockResolvedValueOnce(true)

    const response = await GET(request())
    const body = await response.json()

    expect(skipCronIfPaidBackupOff).toHaveBeenCalledWith('user-1', 'ask-mine')
    expect(sweepExpiredKairosAsks).toHaveBeenCalledWith('user-1')
    expect(runAskMineForUser).not.toHaveBeenCalled()
    expect(body).toMatchObject({ ran: 0, paidBackupOff: ['user-1'] })
  })

  it('requires the configured bearer secret before reading eligible users', async () => {
    process.env.CRON_SECRET = 'cron-secret'

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(listChatDistillEligibleUserIds).not.toHaveBeenCalled()
  })

  it('uses the chat-distill eligibility set and isolates per-user failures', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1', 'user-2'])
    vi.mocked(runAskMineForUser)
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        status: 'created',
        date: '2026-07-19',
        askId: 'ask-2',
        expiresAt: '2026-07-22T04:30:00.000Z',
        candidate: {
          question: 'Should Atlas ship this week?',
          kind: 'decision',
          dominionId: null,
          sourceMemoryIds: ['memory-1'],
          leverage: 0.9,
          rationale: 'It gates two workstreams.',
        },
      })

    const response = await GET(request('/api/cron/ask-mine', 'Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ran: 2, skipped: 0, asksCreated: 1, dryRun: false })
    expect(runAskMineForUser).toHaveBeenNthCalledWith(1, 'user-1', { dryRun: false })
    expect(runAskMineForUser).toHaveBeenNthCalledWith(2, 'user-2', { dryRun: false })
    expect(writeCronFailureTrace).toHaveBeenCalledWith('user-1', expect.objectContaining({
      cronName: 'ask-mine',
      reason: 'uncaught_exception',
    }))
  })

  it('passes the dryRun query flag through to every eligible user', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1'])
    vi.mocked(runAskMineForUser).mockResolvedValue({
      status: 'dry_run',
      date: '2026-07-19',
      signalCount: 4,
      modelInput: { system: 'system', prompt: 'prompt', cacheSystem: true, maxOutputTokens: 4000 },
    })

    const response = await GET(request('/api/cron/ask-mine?dryRun=1', 'Bearer cron-secret'))
    const body = await response.json()

    expect(body).toMatchObject({ ran: 1, asksCreated: 0, dryRun: true })
    expect(runAskMineForUser).toHaveBeenCalledWith('user-1', { dryRun: true })
    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('writes an ok outcome trace for a created ask and a skipped trace with the reason', async () => {
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1', 'user-2'])
    vi.mocked(runAskMineForUser)
      .mockResolvedValueOnce({
        status: 'created',
        date: '2026-07-19',
        askId: 'ask-1',
        expiresAt: '2026-07-22T04:30:00.000Z',
        candidate: {
          question: 'Should Atlas ship this week?',
          kind: 'decision',
          dominionId: null,
          sourceMemoryIds: ['memory-1'],
          leverage: 0.9,
          rationale: 'It gates two workstreams.',
        },
      })
      .mockResolvedValueOnce({ status: 'skipped', date: '2026-07-19', reason: 'awaiting_reply' })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(writeCronSuccessTrace).toHaveBeenCalledTimes(2)
    expect(writeCronSuccessTrace).toHaveBeenNthCalledWith(1, 'user-1', expect.objectContaining({ cronName: 'ask-mine', outcome: 'ok' }))
    expect(writeCronSuccessTrace).toHaveBeenNthCalledWith(2, 'user-2', expect.objectContaining({
      cronName: 'ask-mine',
      outcome: 'skipped',
      skipReason: 'awaiting_reply',
    }))
  })

  it('writes no outcome trace for a user whose run threw', async () => {
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1'])
    vi.mocked(runAskMineForUser).mockRejectedValue(new Error('boom'))

    await GET(request())

    expect(writeCronSuccessTrace).not.toHaveBeenCalled()
    expect(writeCronFailureTrace).toHaveBeenCalledOnce()
  })

  it('sweeps expired asks before each live run and reports the counts', async () => {
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1', 'user-2'])
    vi.mocked(sweepExpiredKairosAsks)
      .mockResolvedValueOnce({ examined: 2, expired: 2 })
      .mockRejectedValueOnce(new Error('sweep down'))
    vi.mocked(runAskMineForUser).mockResolvedValue({ status: 'skipped', date: '2026-07-19', reason: 'no_signals' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const body = await (await GET(request())).json()
    errorSpy.mockRestore()

    expect(body).toMatchObject({ ran: 2, asksExpired: 2 })
    expect(body.users[0]).toMatchObject({ userId: 'user-1', expiredAsks: 2 })
    expect(body.users[1]).not.toHaveProperty('expiredAsks')
    // A failed sweep never blocks that user's ask-mine run.
    expect(runAskMineForUser).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sweepExpiredKairosAsks).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(runAskMineForUser).mock.invocationCallOrder[0]!)
  })

  it('does not sweep on a dry run', async () => {
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1'])
    vi.mocked(runAskMineForUser).mockResolvedValue({
      status: 'dry_run',
      date: '2026-07-19',
      signalCount: 1,
      modelInput: { system: 's', prompt: 'p', cacheSystem: true, maxOutputTokens: 4000 },
    })

    const body = await (await GET(request('/api/cron/ask-mine?dryRun=1'))).json()

    expect(sweepExpiredKairosAsks).not.toHaveBeenCalled()
    expect(body).toMatchObject({ asksExpired: 0, dryRun: true })
  })

  it('reports users skipped after the 240-second deadline guard', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1', 'user-2'])
    vi.mocked(runAskMineForUser).mockResolvedValue({
      status: 'skipped',
      date: '2026-07-19',
      reason: 'no_candidate',
    })
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(300_000)

    const response = await GET(request('/api/cron/ask-mine', 'Bearer cron-secret'))
    const body = await response.json()
    nowSpy.mockRestore()

    expect(body).toMatchObject({ ran: 1, skipped: 1, skippedUserIds: ['user-2'] })
    expect(runAskMineForUser).toHaveBeenCalledTimes(1)
  })
})
